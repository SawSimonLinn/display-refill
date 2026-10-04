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
                ProductionStoreView(store: store, api: api, lockStore: { lockedStore = $0 })
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
    let lockStore: (Bool) -> Void
    @State private var model: ProductionWorksheet
    @FocusState private var focused: String?
    @State private var sectionFilter = ""
    @State private var categoryFilter = ""
    @State private var typeFilter = ""
    @State private var quantitySort = true
    @State private var discardEdits = false
    init(store: Me.Store, api: any ProductionAPI, lockStore: @escaping (Bool) -> Void) {
        self.lockStore = lockStore
        self.store = store
        _model = State(initialValue: ProductionWorksheet(api: api, storeID: store.id.uuidString))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(store.name).font(.subheadline).foregroundStyle(.secondary)
                if let error = model.error {
                    VStack(alignment: .leading, spacing: 12) {
                        Label(error, systemImage: "exclamationmark.circle").fixedSize(horizontal: false, vertical: true)
                        if model.conflict {
                            Button("Load latest, keep my edits") { Task { await model.reloadConflict() } }
                        } else {
                            Button("Retry / Save my edits") { Task { await model.retry() } }.disabled(model.busy)
                        }
                    if model.pending && !model.busy {
                            Button("Discard unsaved edits", role: .destructive) { discardEdits = true }
                        }
                    }.padding().background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                }
                if let check = model.check, check.status == "draft" {
                    editor(check)
                } else {
                    if model.pending, model.check?.status == "finished" {
                        Text("Your unsaved entries were not applied to the finished check.")
                        ForEach(model.check?.items ?? []) { item in
                            Text("\(item.product_name): \(model.input[item.id] ?? "Not counted")")
                        }
                        Button("Discard unsaved entries & return to sections", role: .destructive) { model.discardFinishedEdits() }
                    }
                    sections
                    if let day = model.day { summary(day) }
                }
            }.padding()
        }
        .navigationTitle("Today")
        .tint(.green)
        .task { await model.load() }
        .confirmationDialog("Discard only your unsaved edits? Saved counts remain.", isPresented: $discardEdits, titleVisibility: .visible) {
            Button("Discard unsaved edits", role: .destructive) { model.discardLocalEdits() }
        }
        .onChange(of: model.pending || model.busy) { _, locked in lockStore(locked) }
        .toolbar {
            #if os(iOS)
            ToolbarItemGroup(placement: .keyboard) {
                Button("Next item") { nextField() }
                Spacer()
                Button("Done") { focused = nil; Task { await model.save() } }
            }
            #endif
        }
    }
    private var sections: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Count a section").font(.title2.bold())
            Text("Check each section in order. For shared products, count each display separately and cooler backup once when asked.").foregroundStyle(.secondary)
            ForEach(Array(ProductionSection.allCases.enumerated()), id: \.element.id) { index, section in
                let finished = model.day?.sections.first(where: { $0.section == section })
                Button {
                    Task { await model.start(section) }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(index + 1). \(section.label)").font(.headline)
                        if let time = finished?.finished_at {
                            Text("Finished \(timeLabel(time)) · \(finished?.in_progress == true ? "Recheck in progress" : "Check again")").font(.subheadline)
                        } else { Text(finished?.in_progress == true ? "In progress · Open / resume" : "Not finished today · Start counting").font(.subheadline) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding()
                        .background(.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain).disabled(model.busy || model.pending)
            }
            Text("No products configured? Ask your manager to set up this store’s sections and stocking amounts.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
    private func editor(_ check: ProductionCheck) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(check.section.label).font(.title2.bold())
            Text("HAVE includes backup unless the item says Display only.").font(.subheadline)
            Text(model.busy ? "Saving…" : model.pending ? "Unsaved entries" : "All entries saved")
                .font(.subheadline).foregroundStyle(model.pending ? Color.orange : Color.secondary)
                .accessibilityIdentifier("production-save-status")
            ForEach(check.items) { item in
                VStack(alignment: .leading, spacing: 12) {
                    Text(item.product_name).font(.headline).fixedSize(horizontal: false, vertical: true)
                    if (item.shared_size ?? 1) > 1 {
                        Text("Display only · This product is also in another section.").font(.subheadline)
                        if item.backup_required != true { Text("Shared cooler backup is counted in the first section containing this product.").font(.footnote) }
                    }
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 32) { haveField(item); makeLabel(item) }
                        VStack(alignment: .leading, spacing: 12) { haveField(item); makeLabel(item) }
                    }
                    if item.backup_required == true {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Shared cooler backup · count once").font(.subheadline.bold())
                            TextField("Not counted", text: Binding(get: { model.input[item.id + ":backup"] ?? "" }, set: { model.edit(item.id + ":backup", text: $0) }))
                                .textFieldStyle(.roundedBorder)
                                #if os(iOS)
                                .keyboardType(.numberPad)
                                #endif
                                .focused($focused, equals: item.id + ":backup")
                                .accessibilityLabel("Shared backup, \(item.product_name)")
                                .accessibilityIdentifier("production-backup-\(item.id)")
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
                    .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            }
            Button {
                focused = nil
                Task {
                    await model.finish()
                    if model.check?.status == "finished",
                       let index = ProductionSection.allCases.firstIndex(of: check.section),
                       index + 1 < ProductionSection.allCases.count {
                        await model.start(ProductionSection.allCases[index + 1])
                    }
                }
            } label: {
                Text(check.section == .veggieCase ? "Finish & see what to make" : "Finish & next section")
                    .font(.headline).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity).padding(.vertical, 8)
            }.buttonStyle(.borderedProminent).disabled(!model.canFinish)
            Button("Back to sections") { focused = nil; model.returnToSections() }.disabled(model.pending || model.busy)
            Text("Blank means not counted. Enter 0 when none are available. Finish includes this section in today’s list.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
    private func haveField(_ item: ProductionItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text((item.shared_size ?? 1) > 1 ? "HAVE · DISPLAY" : "HAVE").font(.caption.bold())
            TextField("Not counted", text: Binding(get: { model.input[item.id] ?? "" }, set: { model.edit(item.id, text: $0) }))
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .focused($focused, equals: item.id)
                .accessibilityLabel("Have, \(item.product_name)")
                .accessibilityHint((item.shared_size ?? 1) > 1 ? "Display stock only. Shared backup is entered separately once." : "Include prepared backup stock. Leave blank if not counted.")
                .accessibilityIdentifier("production-have-\(item.id)")
        }.frame(minWidth: 140)
    }
    private func makeLabel(_ item: ProductionItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("MAKE").font(.caption.bold())
            Text(model.pending || model.busy ? "Saving…" : item.make.map(String.init) ?? ((item.shared_size ?? 1) > 1 ? "After both sections" : "—"))
                .font(.title2.bold()).foregroundStyle(.green)
        }.accessibilityElement(children: .combine)
    }
    private func nextField() {
        guard let items = model.check?.items else { return }
        let fields = items.flatMap { $0.backup_required == true ? [$0.id, $0.id + ":backup"] : [$0.id] }
        if let focused, let index = fields.firstIndex(of: focused), index + 1 < fields.count { self.focused = fields[index + 1] }
        else { focused = nil }
        Task { await model.save() }
    }
    private func summary(_ day: ProductionDay) -> some View {
        let rows = day.sections.flatMap { section in section.items.map { (section.section, $0) } }
        let filtered = rows.filter { section, item in
            (item.make ?? 0) > 0 && (sectionFilter.isEmpty || section.rawValue == sectionFilter) && (categoryFilter.isEmpty || item.category == categoryFilter) && (typeFilter.isEmpty || item.product_type == typeFilter)
        }.sorted { a, b in quantitySort && a.1.make != b.1.make ? (a.1.make ?? 0) > (b.1.make ?? 0) : a.1.product_name < b.1.product_name }
        return VStack(alignment: .leading, spacing: 16) {
            Divider()
            Text("Need to make now").font(.title2.bold())
            Text("\(day.total_make) containers").font(.largeTitle.bold())
            Text(day.complete ? "Latest finished check from each section · \(day.date)" : "Partial total · Finish all four sections for a complete list.").foregroundStyle(.secondary)
            Text("Shared stock is deducted once across sections; unfinished shared products are excluded. Rechecking replaces that section’s earlier shortage only when finished. Drafts are excluded. This is not a total of what was made today.").font(.footnote).foregroundStyle(.secondary)
            Picker("Section", selection: $sectionFilter) {
                Text("All sections").tag("")
                ForEach(ProductionSection.allCases) { Text($0.label).tag($0.rawValue) }
            }
            Picker("Category", selection: $categoryFilter) {
                Text("All categories").tag("")
                ForEach(Array(Set(rows.map { $0.1.category }.filter { !$0.isEmpty })).sorted(), id: \.self) { Text($0).tag($0) }
            }
            Picker("Type", selection: $typeFilter) {
                Text("All types").tag("")
                ForEach(Array(Set(rows.map { $0.1.product_type }.filter { !$0.isEmpty })).sorted(), id: \.self) { Text($0).tag($0) }
            }
            Picker("Sort", selection: $quantitySort) { Text("Largest amount first").tag(true); Text("Product name").tag(false) }
            Text("Shown: \(filtered.reduce(0) { $0 + ($1.1.make ?? 0) }) containers").font(.headline)
            if filtered.isEmpty { Text("No items to make in this selection. Unfinished sections are not included.").foregroundStyle(.secondary) }
            ForEach(filtered, id: \.1.id) { section, item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.product_name).font(.headline)
                    Text("Make \(item.make ?? 0)").font(.title3.bold()).foregroundStyle(.green)
                    Text(section.label).font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Divider()
            }
            Button("Refresh today’s list") { Task { await model.load() } }
        }
    }
    private func timeLabel(_ raw: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date.formatted(date: .omitted, time: .shortened) }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)?.formatted(date: .omitted, time: .shortened) ?? raw
    }
}
