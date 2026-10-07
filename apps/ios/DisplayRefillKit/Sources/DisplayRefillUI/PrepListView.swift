import DisplayRefillCore
import SwiftUI

struct PrepListView: View {
    let stores: [Me.Store]
    let api: any PrepAPI
    let userID: String
    @State private var selected = ""
    @State private var locked = false
    var body: some View {
        Group {
            if let store = stores.first(where: { $0.id.uuidString == selected }) {
                PrepStoreView(store: store, api: api, userID: userID, lockStore: { locked = $0 })
                    .id(selected)
                    .toolbar {
                        ToolbarItem(placement: .secondaryAction) {
                            Menu("Switch store") {
                                ForEach(stores) { item in
                                    Button(item.name) { selected = item.id.uuidString; UserDefaults.standard.set(selected, forKey: "production.store.\(userID)") }
                                }
                            }.disabled(locked)
                        }
                    }
            } else { ContentUnavailableView("No stores assigned", systemImage: "storefront") }
        }
        .task {
            guard !locked else { return }
            let remembered = UserDefaults.standard.string(forKey: "production.store.\(userID)")
            selected = stores.first(where: { $0.id.uuidString == remembered })?.id.uuidString ?? stores.first?.id.uuidString ?? ""
        }
    }
}
private struct PrepStoreView: View {
    let store: Me.Store
    let lockStore: (Bool) -> Void
    @State private var model: PrepListModel
    @State private var category = ""
    @State private var type = ""
    @State private var sortOrder: PrepSortOrder = .sections
    @State private var family = ""
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var showCompleted = false
    @State private var doneItem: PrepItem?
    @State private var filtersOpen = false
    @State private var infoOpen = false
    @FocusState private var focused: String?
    @Environment(\.scenePhase) private var scenePhase
    init(store: Me.Store, api: any PrepAPI, userID: String, lockStore: @escaping (Bool) -> Void) {
        self.store = store; self.lockStore = lockStore
        _model = State(initialValue: PrepListModel(api: api, storeID: store.id.uuidString, persistenceKey: "prep.pending.\(userID).\(store.id.uuidString)"))
    }
    private var rows: [PrepItem] {
        PrepPresentation.sorted((model.board?.items ?? []).filter { item in
            (family.isEmpty || PrepPresentation.family(item) == family) &&
            (category.isEmpty || item.category == category) && (type.isEmpty || item.product_type == type) && (showCompleted || item.remaining != 0)
        }, by: sortOrder)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let error = model.error {
                    Notice(text: error, tint: Theme.destructive) {
                        Button(model.pending ? "Retry saving preparation" : "Refresh") { Task { await model.retry() } }
                            .buttonStyle(OutlineButtonStyle()).disabled(model.busy)
                        if model.pending { Text("Keep this screen open until the save is resolved. Do not record the same containers again on another phone.").font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                if let message = model.message { Text(message).font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("prep-save-status") }
                if let board = model.board {
                    if !board.missing_sections.isEmpty {
                        Label("Partial list · No saved count for: \(board.missing_sections.map(\.label).joined(separator: ", ")).", systemImage: "exclamationmark.circle")
                            .font(.footnote).foregroundStyle(Theme.verify)
                    }
                    if board.items.contains(where: { !$0.ready }) {
                        Label("Partial total · Products needing a recount are excluded.", systemImage: "exclamationmark.circle")
                            .font(.footnote).foregroundStyle(Theme.verify)
                    }
                    if rows.isEmpty {
                        Text("No items to make in this selection. Uncounted sections are excluded.")
                            .font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity).multilineTextAlignment(.center).padding(.vertical, 40)
                    }
                    ForEach(rows) { item in row(item) }
                } else if model.loading { ProgressView("Loading prep list") }
            }.padding()
        }
        .background(Theme.page.ignoresSafeArea())
        .navigationTitle("Prep List")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await model.refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .onChange(of: model.pending || model.busy) { _, value in lockStore(value) }
        .confirmationDialog("Record all remaining containers as made?", isPresented: Binding(get: { doneItem != nil }, set: { if !$0 { doneItem = nil } }), titleVisibility: .visible) {
            if let item = doneItem {
                Button("Record \(item.remaining ?? 0) made") { doneItem = nil; Task { await model.record(item, done: true) } }
            }
        }
        .sheet(isPresented: $filtersOpen) {
            NavigationStack {
                Form {
                    if let board = model.board {
                    Picker("Group", selection: $family) {
                        Text("All groups").tag("")
                        ForEach(["Fruit", "Vegetables", "Salads"], id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Category", selection: $category) {
                        Text("All categories").tag("")
                        ForEach(Array(Set(board.items.map(\.category).filter { !$0.isEmpty })).sorted(), id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Type", selection: $type) {
                        Text("All types").tag("")
                        ForEach(Array(Set(board.items.map(\.product_type).filter { !$0.isEmpty })).sorted(), id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Sort", selection: $sortOrder) { ForEach(PrepSortOrder.allCases, id: \.self) { Text($0.label).tag($0) } }
                    HStack {
                        Text("Completed items")
                        Spacer()
                        Toggle("Show completed items", isOn: $showCompleted).labelsHidden()
                    }

                    }
                    Button("Reset filters") { category = ""; type = ""; sortOrder = .sections; family = ""; showCompleted = false }
                }
                .pageBackground()
                .navigationTitle("Filters")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { filtersOpen = false } } }
            }
        }
        .sheet(isPresented: $infoOpen) {
            NavigationStack {
                List {
                    Text("\(store.storeNumber) · \(store.name)")
                    if let date = model.lastLoaded { Text("Updated \(date.formatted(date: .omitted, time: .shortened))") }
                    Text("Record ready-to-sell containers, including those in the prep room. After stock moves or sells, recount every location of that product in Stock Check. Include earlier preparation in your new count.")
                }.pageBackground().navigationTitle("Prep details")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { infoOpen = false } } }
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(model.board.map { "\($0.items.reduce(0) { $0 + ($1.remaining ?? 0) }) to make" } ?? "Prep List")
                    .font(.headline).accessibilityIdentifier("prep-total")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { filtersOpen = true } label: { Image(systemName: category.isEmpty && type.isEmpty && !showCompleted && family.isEmpty && sortOrder == .sections ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill") }
                    .accessibilityLabel("Filters")
            }
            ToolbarItem(placement: .secondaryAction) {
                Button { infoOpen = true } label: { Label("Prep details", systemImage: "info.circle") }
            }
            #if os(iOS)
            let editable = rows.filter { $0.ready && ($0.remaining ?? 0) > 0 }.map(\.id)
            NumberEntryBar(isLast: focused != nil && focused == editable.last) {
                if let focused { model.inputs[focused] = nil }
                focused = fieldAfter(after: focused, in: editable)
            } next: { focused = fieldAfter(after: focused, in: editable) }
            #endif
        }
    }
    private func row(_ item: PrepItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.product_name).font(.headline).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if item.ready {
                    Text("\(item.remaining ?? 0)").font(.system(.largeTitle, weight: .semibold)).monospacedDigit()
                        .foregroundStyle((item.remaining ?? 0) == 0 ? Color.secondary : Theme.action)
                        .accessibilityLabel("\(item.remaining ?? 0) remaining")
                        .accessibilityIdentifier("prep-remaining-\(item.id)")
                }
            }
            if item.ready {
                if (item.remaining ?? 0) > 0 {
                    if textSize.isAccessibilitySize {
                        amountInput(item)
                        VStack(alignment: .leading) { recordButton(item); doneButton(item) }
                    } else {
                        HStack(spacing: 8) {
                            amountInput(item).frame(maxWidth: .infinity)
                            recordButton(item).fixedSize(horizontal: true, vertical: false)
                            doneButton(item).fixedSize(horizontal: true, vertical: false)
                        }
                    }
                }
            } else {
                Label("Recount this product in all its sections before recording preparation.", systemImage: "exclamationmark.circle")
                    .font(.footnote).foregroundStyle(Theme.verify)
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(item.made) made since this count · Counted \(timeLabel(item.oldest_count))").font(.footnote)
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(Array(item.locations.enumerated()), id: \.element.section) { index, location in
                            if index > 0 { Spacer(minLength: 0) }
                            Text("\(locationName(location.section)): \(location.display_need)")
                                .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                    }.frame(maxWidth: .infinity)
                    ForEach(Array(item.activity.enumerated()), id: \.offset) { _, entry in
                        Text("\(entry.name) made \(entry.quantity) · \(timeLabel(entry.at))").font(.subheadline)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(.secondary).padding(.top, 8)
            } label: {
                Text("Locations & recent preparation").font(.subheadline).foregroundStyle(.secondary)
            }
        }.card()
    }
    private func locationName(_ section: ProductionSection) -> String {
        PrepPresentation.locationLabel(section)
    }
    private func amountInput(_ item: PrepItem) -> some View {
        TextField("Made", text: Binding(get: { model.inputs[item.id] ?? "" }, set: { model.inputs[item.id] = $0 }))
            .monospacedDigit().filledField()
            #if os(iOS)
            .keyboardType(.numberPad)
            #endif
            .focused($focused, equals: item.id)
            .accessibilityLabel("Amount just made, \(item.product_name)")
            .accessibilityIdentifier("prep-input-\(item.id)")
    }
    private func recordButton(_ item: PrepItem) -> some View {
        Button { focused = nil; Task { await model.record(item) } } label: { Text("Record").fixedSize(horizontal: false, vertical: true) }
            .buttonStyle(InkCapsuleStyle()).disabled(model.busy || model.pending)
            .accessibilityLabel("Record made").accessibilityIdentifier("prep-record-\(item.id)")
    }
    private func doneButton(_ item: PrepItem) -> some View {
        Button { focused = nil; doneItem = item } label: { Label("Done", systemImage: "checkmark").fixedSize(horizontal: false, vertical: true) }
            .buttonStyle(OutlineButtonStyle()).disabled(model.busy || model.pending)
            .accessibilityLabel("Done · made all remaining")
    }
    private func timeLabel(_ raw: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = f.date(from: raw) { return date.formatted(date: .abbreviated, time: .shortened) }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)?.formatted(date: .abbreviated, time: .shortened) ?? "Unknown"
    }
}
