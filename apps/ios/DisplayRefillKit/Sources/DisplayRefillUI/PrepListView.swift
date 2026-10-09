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
    @State private var sortOrder: PrepSortOrder = .sections
    @State private var family = ""
    @State private var produce = ""
    @State private var category = ""
    @State private var type = ""
    @State private var filtersOpen = false
    /// Collapsed headings, as "group|heading".
    @State private var collapsed: Set<String> = []
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var showCompleted = false
    @State private var doneItem: PrepItem?
    @State private var infoOpen = false
    @FocusState private var focused: String?
    @Environment(\.scenePhase) private var scenePhase
    init(store: Me.Store, api: any PrepAPI, userID: String, lockStore: @escaping (Bool) -> Void) {
        self.store = store; self.lockStore = lockStore
        _model = State(initialValue: PrepListModel(api: api, storeID: store.id.uuidString, persistenceKey: "prep.pending.\(userID).\(store.id.uuidString)"))
    }
    private var rows: [PrepItem] {
        PrepPresentation.sorted(matching(family: true, produce: true, category: true, type: true).filter { item in
            showCompleted || item.remaining != 0 || !(model.inputs[item.id] ?? "").isEmpty
        }, by: sortOrder)
    }
    /// Items passing the chosen filters. Each filter's choices come from the filters above it,
    /// so a list never offers a choice that would show nothing.
    private func matching(family useFamily: Bool = false, produce useProduce: Bool = false, category useCategory: Bool = false, type useType: Bool = false) -> [PrepItem] {
        (model.board?.items ?? []).filter { item in
            (!useFamily || family.isEmpty || PrepPresentation.family(item) == family) &&
            (!useProduce || produce.isEmpty || (PrepPresentation.family(item) == "Fruit" && PrepPresentation.produce(item) == produce)) &&
            (!useCategory || category.isEmpty || item.category == category) &&
            (!useType || type.isEmpty || item.product_type == type)
        }
    }
    private var familyOptions: [String] {
        ["Fruit", "Vegetables", "Salads"].filter { f in (model.board?.items ?? []).contains { PrepPresentation.family($0) == f } }
    }
    private var produceOptions: [String] {
        family.isEmpty || family == "Fruit" ? PrepPresentation.produceOptions(matching(family: true)) : []
    }
    private var categoryOptions: [String] {
        Array(Set(matching(family: true, produce: true).map(\.category).filter { !$0.isEmpty })).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
    private var typeOptions: [String] {
        Array(Set(matching(family: true, produce: true, category: true).map(\.product_type).filter { !$0.isEmpty })).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
    /// Containers still to make among the items a choice would show.
    private func toMake(_ items: [PrepItem]) -> Int { items.reduce(0) { $0 + ($1.remaining ?? 0) } }
    /// Drops choices that no longer exist after an earlier filter changed.
    private func dropStaleFilters() {
        if !produce.isEmpty, !produceOptions.contains(produce) { produce = "" }
        if !category.isEmpty, !categoryOptions.contains(category) { category = "" }
        if !type.isEmpty, !typeOptions.contains(type) { type = "" }
    }
    private func resetFilters() { family = ""; produce = ""; category = ""; type = ""; showCompleted = false; sortOrder = .sections }
    /// The filters in use, each with a way to clear just that one.
    private var activeFilters: [(label: String, clear: () -> Void)] {
        var list: [(label: String, clear: () -> Void)] = []
        if !family.isEmpty { list.append((family, { family = ""; dropStaleFilters() })) }
        if !produce.isEmpty { list.append((produce, { produce = ""; dropStaleFilters() })) }
        if !category.isEmpty { list.append((category, { category = ""; dropStaleFilters() })) }
        if !type.isEmpty { list.append((type, { type = "" })) }
        if showCompleted { list.append(("Showing completed", { showCompleted = false })) }
        if sortOrder != .sections { list.append((sortOrder.label, { sortOrder = .sections })) }
        return list
    }
    /// Headings only in the default order; other orders mix the groups.
    private var grouped: Bool { sortOrder == .sections }
    private func collapseKey(_ item: PrepItem) -> String { "\(PrepPresentation.family(item))|\(PrepPresentation.heading(item))" }
    private func isCollapsed(_ item: PrepItem) -> Bool { grouped && collapsed.contains(collapseKey(item)) }

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
                        Label("Partial total · Products not counted yet are excluded.", systemImage: "exclamationmark.circle")
                            .font(.footnote).foregroundStyle(Theme.verify)
                    }
                    if rows.isEmpty {
                        Text("No items to make in this selection. Uncounted sections are excluded.")
                            .font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity).multilineTextAlignment(.center).padding(.vertical, 40)
                    }
                    if !activeFilters.isEmpty { filterChips }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                        if grouped, index == 0 || collapseKey(rows[index - 1]) != collapseKey(item) {
                            if family.isEmpty, index == 0 || PrepPresentation.family(rows[index - 1]) != PrepPresentation.family(item),
                               PrepPresentation.heading(item) != PrepPresentation.family(item) {
                                Eyebrow(PrepPresentation.family(item)).padding(.top, index == 0 ? 0 : 12).accessibilityAddTraits(.isHeader)
                            }
                            heading(for: item)
                        }
                        if !isCollapsed(item) { row(item) }
                    }
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
        .sheet(isPresented: $filtersOpen) { filterSheet }
        .onChange(of: family) { dropStaleFilters() }
        .onChange(of: produce) { dropStaleFilters() }
        .onChange(of: category) { dropStaleFilters() }
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
                Button { filtersOpen = true } label: {
                    Image(systemName: activeFilters.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(activeFilters.isEmpty ? "Filters" : "Filters, \(activeFilters.count) on")
            }
            if grouped {
                ToolbarItem(placement: .secondaryAction) {
                    Button("Collapse all", systemImage: "chevron.up") { focused = nil; collapsed = Set(rows.map(collapseKey)) }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button("Expand all", systemImage: "chevron.down") { collapsed = [] }.disabled(collapsed.isEmpty)
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button { infoOpen = true } label: { Label("Prep details", systemImage: "info.circle") }
            }
            #if os(iOS)
            let editable = rows.filter { $0.ready && !isCollapsed($0) }.map(\.id)
            NumberEntryBar(isLast: focused != nil && focused == editable.last) {
                if let focused { model.inputs[focused] = nil }
                focused = fieldAfter(after: focused, in: editable)
            } next: { focused = fieldAfter(after: focused, in: editable) }
            #endif
        }
    }
    /// Filters in use, shown above the list; tap one to remove it.
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(activeFilters.enumerated()), id: \.element.label) { _, filter in
                    Button { withAnimation(.snappy) { filter.clear() } } label: { Pill(text: filter.label, systemImage: "xmark", filled: true) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove filter \(filter.label)")
                }
                if activeFilters.count > 1 {
                    Button("Clear all") { withAnimation(.snappy) { resetFilters() } }
                        .font(.footnote.weight(.semibold)).foregroundStyle(Theme.action).frame(minHeight: 44)
                }
            }
        }
    }
    private var filterSheet: some View {
        NavigationStack {
            Form {
                if familyOptions.count > 1 {
                    Section("Group") {
                        Picker("Group", selection: $family) {
                            Text("All").tag("")
                            ForEach(familyOptions, id: \.self) { Text($0).tag($0) }
                        }.pickerStyle(.segmented).labelsHidden()
                    }
                }
                if !produceOptions.isEmpty || !categoryOptions.isEmpty || !typeOptions.isEmpty {
                    Section {
                        if !produceOptions.isEmpty {
                            Picker("Produce", selection: $produce) {
                                Text("All produce").tag("")
                                ForEach(produceOptions, id: \.self) { option in
                                    Text("\(option) · \(toMake(matching(family: true).filter { PrepPresentation.family($0) == "Fruit" && PrepPresentation.produce($0) == option }))").tag(option)
                                }
                            }
                        }
                        if !categoryOptions.isEmpty {
                            Picker("Category", selection: $category) {
                                Text("All categories").tag("")
                                ForEach(categoryOptions, id: \.self) { option in
                                    Text("\(option) · \(toMake(matching(family: true, produce: true).filter { $0.category == option }))").tag(option)
                                }
                            }
                        }
                        if !typeOptions.isEmpty {
                            Picker("Type", selection: $type) {
                                Text("All types").tag("")
                                ForEach(typeOptions, id: \.self) { option in
                                    Text("\(option) · \(toMake(matching(family: true, produce: true, category: true).filter { $0.product_type == option }))").tag(option)
                                }
                            }
                        }
                    } header: { Text("Narrow down") } footer: { Text("Numbers are containers still to make. Choices follow the group you picked.") }
                }
                Section("Sort") {
                    Picker("Sort", selection: $sortOrder) { ForEach(PrepSortOrder.allCases, id: \.self) { Text($0.label).tag($0) } }
                        .pickerStyle(.inline).labelsHidden()
                }
                Section {
                    Toggle("Show completed items", isOn: $showCompleted)
                } footer: {
                    Text("\(rows.count) \(rows.count == 1 ? "item" : "items") · \(toMake(rows)) to make")
                }
                if !activeFilters.isEmpty {
                    Section { Button("Reset all filters", role: .destructive) { resetFilters() } }
                }
            }
            .pageBackground()
            .navigationTitle("Filters")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { filtersOpen = false } } }
        }
        .presentationDetents([.medium, .large])
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
            } else {
                Label("Count this product in Stock Check to see how many to make.", systemImage: "exclamationmark.circle")
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
    /// Tappable heading: fruit by produce, the rest by category. Collapsing hides its items.
    private func heading(for item: PrepItem) -> some View {
        let key = collapseKey(item)
        let open = !collapsed.contains(key)
        let items = rows.filter { collapseKey($0) == key }
        let toMake = items.reduce(0) { $0 + ($1.remaining ?? 0) }
        return Button {
            if open, let focused, items.contains(where: { $0.id == focused }) { self.focused = nil }
            withAnimation(.snappy) { if open { collapsed.insert(key) } else { collapsed.remove(key) } }
        } label: {
            HStack(spacing: 10) {
                Text(PrepPresentation.heading(item)).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text(toMake == 0 ? "Done" : "\(toMake) to make").font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                Image(systemName: "chevron.right").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    .rotationEffect(.degrees(open ? 90 : 0))
            }
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue("\(open ? "Expanded" : "Collapsed"), \(toMake) to make")
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
            .buttonStyle(InkCapsuleStyle()).disabled(model.busy || model.pending || (item.remaining ?? 0) == 0)
            .accessibilityLabel("Record made").accessibilityIdentifier("prep-record-\(item.id)")
    }
    private func doneButton(_ item: PrepItem) -> some View {
        Button { focused = nil; doneItem = item } label: { Label("Done", systemImage: "checkmark").fixedSize(horizontal: false, vertical: true) }
            .buttonStyle(OutlineButtonStyle()).disabled(model.busy || model.pending || (item.remaining ?? 0) == 0)
            .accessibilityLabel("Done · made all remaining")
    }
    private func timeLabel(_ raw: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = f.date(from: raw) { return date.formatted(date: .abbreviated, time: .shortened) }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)?.formatted(date: .abbreviated, time: .shortened) ?? "Unknown"
    }
}
