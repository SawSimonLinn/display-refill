import DisplayRefillCore
import SwiftUI

struct ProductionTodayView: View {
    let stores: [Me.Store]
    let api: any ProductionAPI
    let userID: String
    @State private var selected = ""
    @State private var lockedStore = false
    var body: some View {
        Group {
            if stores.isEmpty {
                ContentUnavailableView("No stores assigned", systemImage: "storefront", description: Text("Ask your manager to assign your store."))
            } else if let store = stores.first(where: { $0.id.uuidString == selected }) {
                ProductionStoreView(store: store, api: api, userID: userID, lockStore: { lockedStore = $0 })
                    .id(selected)
                    .toolbar {
                        ToolbarItem(placement: .secondaryAction) {
                            Menu("Switch store") {
                                ForEach(stores) { item in
                                    Button(item.name) { selected = item.id.uuidString; UserDefaults.standard.set(selected, forKey: "production.store.\(userID)") }
                                }
                            }.disabled(lockedStore)
                        }
                    }
            } else { ProgressView("Loading store") }
        }
        .task {
            let remembered = UserDefaults.standard.string(forKey: "production.store.\(userID)")
            selected = stores.first(where: { $0.id.uuidString == remembered })?.id.uuidString ?? stores.first?.id.uuidString ?? ""
        }
    }
}

private struct ProductionStoreView: View {
    let store: Me.Store
    let api: any ProductionAPI
    let userID: String
    let lockStore: (Bool) -> Void
    @State private var model: ProductionWorksheet
    @FocusState private var focused: String?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var discardEdits = false
    @State private var restart = false
    init(store: Me.Store, api: any ProductionAPI, userID: String, lockStore: @escaping (Bool) -> Void) {
        self.lockStore = lockStore
        self.store = store; self.api = api; self.userID = userID
        _model = State(initialValue: ProductionWorksheet(api: api, storeID: store.id.uuidString))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Pill(text: "\(store.storeNumber) · \(store.name)", systemImage: "storefront")
                if let error = model.error {
                    Notice(text: error) {
                        if model.freshCountRequired {
                            Text("Your numbers are kept in the fresh count. Check any product that was made or recounted, then finish again.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Start fresh count, keep my numbers") { focused = nil; Task { await model.restartCount(keepEntries: true) } }
                                .buttonStyle(OutlineButtonStyle()).disabled(model.busy)
                        } else if model.conflict {
                            Text("If preparation changed during counting, start a fresh count including the new containers.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Load latest, keep my edits") { Task { await model.reloadConflict() } }
                                .buttonStyle(OutlineButtonStyle())
                        } else {
                            if model.pending {
                                Button("Retry / Save my edits") { Task { await model.retry() } }
                                    .buttonStyle(OutlineButtonStyle()).disabled(model.busy)
                            } else {
                                Button("Dismiss") { model.clearError() }
                                    .buttonStyle(OutlineButtonStyle()).disabled(model.busy)
                            }
                        }
                    if model.pending && !model.busy {
                            Button("Discard unsaved edits", role: .destructive) { discardEdits = true }
                                .font(.subheadline).frame(minHeight: 44)
                        }
                    }
                }
                if let check = model.check, check.status == "draft" {
                    editor(check)
                } else {
                    if model.pending, model.check?.status == "finished" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Your unsaved entries were not applied to the finished check.").font(.subheadline)
                            ForEach(model.check?.items ?? []) { item in
                                Text("\(item.product_name): \(model.input[item.id] ?? "Not counted")")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Button("Discard unsaved entries & return to sections", role: .destructive) { model.discardFinishedEdits() }
                                .font(.subheadline).frame(minHeight: 44)
                        }.card()
                    }
                    if let operations = api as? any OperationsAPI {
                        OperationsSummaryView(store: store, api: operations, stock: api as? any PrepAPI)
                    }
                    sections
                }
            }.padding()
        }
        // A newly opened count begins at its first item; saves keep the same identity.
        .id(model.check?.status == "draft" ? model.check?.id ?? "sections" : "sections")
        .background(Theme.page.ignoresSafeArea())
        .navigationTitle("Stock Check")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await model.load() }
        .confirmationDialog("Discard only your unsaved edits? Saved counts remain.", isPresented: $discardEdits, titleVisibility: .visible) {
            Button("Discard unsaved edits", role: .destructive) { model.discardLocalEdits() }
        }
        .confirmationDialog("Start a fresh count? Earlier draft entries stay in history. Count all ready containers again, including preparation already recorded.", isPresented: $restart, titleVisibility: .visible) {
            Button("Start fresh count", role: .destructive) { Task { await model.restartCount() } }
        }
        .onChange(of: model.pending || model.busy) { _, locked in lockStore(locked) }
        .toolbar {
            if model.check?.status == "draft" {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        focused = nil
                        Task { await model.save(); if model.saved { model.returnToSections() } }
                    } label: { Label("Sections", systemImage: "chevron.left") }
                    .accessibilityLabel("Back to sections")
                    .disabled(model.busy || model.conflict)
                }
            }
            #if os(iOS)
            NumberEntryBar(isLast: focused != nil && focused == model.check?.items.last?.id) {
                if let focused { model.edit(focused, text: "") }
                nextField()
            } next: { nextField() }
            #endif
        }
    }
    private var sections: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Sections").padding(.top, 8).accessibilityAddTraits(.isHeader)
            ForEach(Array(model.sections.enumerated()), id: \.element.id) { index, section in
                let finished = model.day?.sections.first(where: { $0.section == section })
                Button {
                    Task { await model.start(section) }
                } label: {
                    HStack(spacing: 14) {
                        Group {
                            if finished?.finished_at != nil && finished?.in_progress != true {
                                Image(systemName: "checkmark").font(.subheadline.bold())
                            } else {
                                Text("\(index + 1)").font(.subheadline.bold()).monospacedDigit()
                            }
                        }
                        .frame(width: 36, height: 36)
                        .background(Theme.field, in: Circle())
                        .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(index + 1). \(model.label(section))").font(.headline)
                            Group {
                                if let time = finished?.finished_at {
                                    Text("Finished \(timeLabel(time)) · \(finished?.in_progress == true ? "Recheck in progress" : "Check again")")
                                } else { Text(finished?.in_progress == true ? "Resume count" : "Start count") }
                            }.font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }.contentShape(Rectangle()).card(padding: 14)
                }.buttonStyle(.plain).disabled(model.busy || model.pending)
            }
        }
    }
    private func editor(_ check: ProductionCheck) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.label(check.section)).font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
            let counted = check.items.filter { !(model.input[$0.id] ?? "").isEmpty }.count
            ProgressView(value: Double(counted), total: Double(max(check.items.count, 1)))
                .tint(Theme.action).accessibilityHidden(true)
            HStack {
                Text("\(check.items.filter { !(model.input[$0.id] ?? "").isEmpty }.count) of \(check.items.count) counted")
                Spacer()
                Text(model.busy ? "Saving…" : model.pending ? "Unsaved" : "Saved")
                    .accessibilityLabel(model.busy ? "Saving…" : model.pending ? "Unsaved entries" : "All entries saved")
                    .accessibilityIdentifier("production-save-status")
            }.font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(model.pending ? Theme.verify : Color.secondary)
                .padding(.bottom, 4)
            ForEach(check.items) { item in
                // Category headings: 6ft fruit, and any non-standard type whose admin set categories.
                if check.section == .fruitCase || (!check.section.isStandard && !item.category.isEmpty),
                   let index = check.items.firstIndex(where: { $0.id == item.id }),
                   index == 0 || check.items[index - 1].category != item.category {
                    Text(item.category.isEmpty ? "Fruit" : item.category)
                        .font(.title2.bold())
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 10)
                        .overlay(alignment: .leading) { Capsule().fill(Theme.action).frame(width: 4) }
                        .padding(.top, 16)
                        .accessibilityAddTraits(.isHeader)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text(item.product_name).font(.headline).fixedSize(horizontal: false, vertical: true)
                    // Keep number-entry focus stable while the server updates the shortage.
                    if dynamicTypeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 12) { haveField(item); makeLabel(item) }
                    } else {
                        HStack(alignment: .center, spacing: 16) { haveField(item); makeLabel(item).frame(width: 88, alignment: .trailing) }
                    }
                }.card()
            }
            Button {
                focused = nil
                Task {
                    await model.finish()
                    if model.check?.status == "finished", let next = model.section(after: check.section) {
                        await model.start(next)
                    }
                }
            } label: {
                Text(model.section(after: check.section) == nil ? "Finish & see what to make" : "Finish & next section")
                    .fixedSize(horizontal: false, vertical: true)
            }.buttonStyle(PrimaryButtonStyle()).disabled(!model.canFinish).padding(.top, 8)
            Menu("More") {
                Button("Start fresh count", role: .destructive) { restart = true }
                    .disabled(model.busy || model.pending && !model.conflict)
            }.font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
            Text("Blank items count as 0 when you finish.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    private func haveField(_ item: ProductionItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow("Have")
            TextField("Not counted", text: Binding(get: { model.input[item.id] ?? "" }, set: { model.edit(item.id, text: $0) }))
                .font(.title3.weight(.semibold)).monospacedDigit()
                .filledField()
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .focused($focused, equals: item.id)
                .accessibilityLabel("Have, \(item.product_name)")
                .accessibilityHint("Count containers in this display. Blank counts as 0.")
                .accessibilityIdentifier("production-have-\(item.id)")
        }.frame(minWidth: 100, maxWidth: .infinity)
    }
    private func makeLabel(_ item: ProductionItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow("To make")
            Text(item.make.map(String.init) ?? "—")
                .accessibilityIdentifier("production-make-\(item.id)")
                .font(.system(.largeTitle, weight: .semibold)).monospacedDigit()
        }.accessibilityElement(children: .combine)
    }
    private func nextField() {
        guard let items = model.check?.items else { return }
        focused = fieldAfter(after: focused, in: items.map(\.id))
        Task { await model.save() }
    }
    private func timeLabel(_ raw: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date.formatted(date: .omitted, time: .shortened) }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)?.formatted(date: .omitted, time: .shortened) ?? raw
    }
}
