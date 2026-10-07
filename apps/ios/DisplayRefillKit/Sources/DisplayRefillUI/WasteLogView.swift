import Charts
import DisplayRefillCore
import SwiftUI

struct OperationsSummaryView: View {
    let store: Me.Store
    let api: any OperationsAPI
    var stock: (any PrepAPI)?
    @State private var report: OperationsReport?
    @State private var board: PrepBoard?
    @State private var error: String?
    @Environment(\.scenePhase) private var phase
    var body: some View {
        NavigationLink { OperationsReportView(store: store, api: api) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Eyebrow("Today")
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                StockFigures(showsOnHand: stock != nil, onHand: board?.onHand, made: report?.made, wasted: report?.wasted)
                    .accessibilityIdentifier("operations-today")
                Text(stock == nil ? "Today’s made & waste" : "On hand now · made & waste today").font(.subheadline).foregroundStyle(.secondary)
                if let board { UncountedNote(board: board) }
                if let error { Label(error, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(Theme.verify) }
            }.card()
        }.buttonStyle(.plain)
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                do { report = try await api.operations(storeID: store.id.uuidString, day: nil, period: "day"); error = nil }
                catch { report = nil; self.error = HistoryFailure.message(error) }
                if let stock {
                    do { board = try await stock.prepBoard(storeID: store.id.uuidString) }
                    catch { board = nil; if self.error == nil { self.error = HistoryFailure.message(error) } }
                }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
}
private struct OperationsReportView: View {
    let store: Me.Store
    let api: any OperationsAPI
    @State private var period = "day"
    @State private var report: OperationsReport?
    @State private var error: String?
    var body: some View {
        List {
            Picker("Period", selection: $period) { Text("Day").tag("day"); Text("Week").tag("week"); Text("Month").tag("month") }.pickerStyle(.segmented)
            if let report {
                Section {
                    WasteWeekSummary(report: report, timezone: report.timezone)
                } header: { Text(report.start_date == report.end_date ? storeDayLabel(report.start_date, timezone: report.timezone, format: "EEE d MMM") : "\(storeDayLabel(report.start_date, timezone: report.timezone, format: "d MMM")) – \(storeDayLabel(report.end_date, timezone: report.timezone, format: "d MMM"))") }
                let active = report.products.filter { $0.made > 0 || $0.wasted > 0 }
                if !active.isEmpty {
                    Section("By product") {
                        ForEach(active) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.product_name).font(.headline)
                                HStack { Text("\(item.made) made"); Spacer(); Text("\(item.wasted) wasted") }.font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else if error == nil { ProgressView() }
            if let error { Text(error).foregroundStyle(.red) }
        }.pageBackground().navigationTitle("Made & Waste")
        .task(id: period) {
            report = nil; error = nil
            do { let result = try await api.operations(storeID: store.id.uuidString, day: nil, period: period); if !Task.isCancelled { report = result } }
            catch { if !Task.isCancelled { self.error = HistoryFailure.message(error) } }
        }
    }
}
struct WasteLogView: View {
    let stores: [Me.Store]
    let api: any OperationsAPI
    var stock: (any PrepAPI)?
    let userID: String
    @State private var selected = ""
    @State private var locked = false
    var body: some View {
        Group {
            if let store = stores.first(where: { $0.id.uuidString == selected }) {
                WasteStoreView(store: store, api: api, stock: stock, userID: userID, lockStore: { locked = $0 }).id(selected)
            } else { ContentUnavailableView("No stores assigned", systemImage: "storefront") }
        }
        .toolbar {
            if stores.count > 1 {
                ToolbarItem(placement: .secondaryAction) {
                    Menu("Switch store") { ForEach(stores) { store in Button(store.name) { selected = store.id.uuidString; UserDefaults.standard.set(selected, forKey: "production.store.\(userID)") } } }.disabled(locked)
                }
            }
        }
        .task {
            let remembered = UserDefaults.standard.string(forKey: "production.store.\(userID)")
            selected = stores.first(where: { $0.id.uuidString == remembered })?.id.uuidString ?? stores.first?.id.uuidString ?? ""
        }
    }
}
private struct WasteStoreView: View {
    let store: Me.Store
    let api: any OperationsAPI
    let stock: (any PrepAPI)?
    let lockStore: (Bool) -> Void
    @State private var model: WasteLogModel
    @State private var board: PrepBoard?
    @State private var date = Date()
    @State private var editing: OperationsReport.Entry?
    @State private var undo: OperationsReport.Entry?
    @Environment(\.scenePhase) private var phase
    init(store: Me.Store, api: any OperationsAPI, stock: (any PrepAPI)?, userID: String, lockStore: @escaping (Bool) -> Void) {
        self.store = store; self.api = api; self.stock = stock; self.lockStore = lockStore
        _model = State(initialValue: WasteLogModel(api: api, storeID: store.id.uuidString, persistenceKey: "waste.pending.\(userID).\(store.id.uuidString)"))
    }
    private var day: String { StoreDay.string(date, timezone: store.timezone) }
    private var today: String { StoreDay.string(Date(), timezone: store.timezone) }
    private var locked: Bool { model.pending || model.busy }
    private func select(_ value: String) { if value <= today, let start = StoreDay.date(value, timezone: store.timezone) { date = start } }
    var body: some View {
        List {
            Section {
                WasteDayStrip(day: day, today: today, timezone: store.timezone, week: model.week, date: $date, select: select).disabled(locked)
            }
            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            if model.pending || model.error != nil {
                Section {
                    if let error = model.error { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(Theme.verify) }
                    if model.pending {
                        if let mutation = model.pendingMutation { Text(pendingText(mutation)).font(.subheadline) }
                        Button("Retry waste save") { Task { await model.retry() } }.disabled(model.busy)
                    } else if model.report == nil { Button("Reload") { Task { await model.load(day: day) } } }
                }
            }
            if let report = model.report {
                Section { daySummary(report) }
                Section {
                    WasteQuickLog(model: model, day: day, catalog: report.catalog).id(day)
                } header: { Text(day == today ? "Log waste" : "Log waste for \(storeDayLabel(day, timezone: store.timezone, format: "EEE d MMM"))") }
                let active = report.entries.filter { !$0.voided }
                Section {
                    if active.isEmpty { Text("Nothing logged yet. Search above and enter how many containers you threw away.").font(.subheadline).foregroundStyle(.secondary) }
                    ForEach(active) { entry in
                        Button { if entry.can_void { editing = entry } } label: { WasteEntryRow(entry: entry, timezone: store.timezone) }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing) {
                                if entry.can_void {
                                    Button("Undo", role: .destructive) { undo = entry }
                                    Button("Edit") { editing = entry }.tint(.gray)
                                }
                            }
                            .disabled(locked)
                            .accessibilityIdentifier("waste-entry-\(entry.id)")
                    }
                    if report.entries.count == 200 { Text("Showing the latest 200 entries for this date.").font(.caption) }
                } header: {
                    HStack { Text("Logged"); Spacer(); Text("\(report.wasted) containers").monospacedDigit() }
                } footer: { if active.contains(where: \.can_void) { Text("Tap an entry to change the amount or reason. After discarding stock, update HAVE in Stock Check.") } }
                let removed = report.entries.filter(\.voided)
                if !removed.isEmpty {
                    Section("Undone or corrected") {
                        ForEach(removed) { entry in WasteEntryRow(entry: entry, timezone: store.timezone).opacity(0.55).accessibilityIdentifier("waste-entry-\(entry.id)") }
                    }
                }
                if let week = model.week {
                    Section {
                        WasteWeekSummary(report: week, selected: day, timezone: store.timezone, select: select)
                        NavigationLink("Month and full report") { OperationsReportView(store: store, api: api) }
                    } header: { Text("Week of \(storeDayLabel(week.start_date, timezone: store.timezone, format: "d MMM"))") }
                }
            } else if model.loading { Section { ProgressView("Loading waste log").frame(maxWidth: .infinity) } }
        }
        .pageBackground()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Waste Log")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await model.load(day: day) }
        .task(id: day + String(describing: phase)) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.load(day: day)
                if let stock { board = try? await stock.prepBoard(storeID: store.id.uuidString) }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .onChange(of: locked) { _, value in lockStore(value) }
        .sensoryFeedback(.success, trigger: model.saved) { _, new in new }
        .sheet(item: $editing) { entry in WasteEditView(model: model, entry: entry, timezone: store.timezone) }
        .confirmationDialog("Undo this waste entry? Its history will remain.", isPresented: Binding(get: { undo != nil }, set: { if !$0 { undo = nil } }), titleVisibility: .visible) {
            if let undo { Button("Undo \(undo.quantity) · \(undo.product_name)", role: .destructive) { self.undo = nil; Task { await model.save(.undo(undo.id)) } } }
        }
    }
    private func daySummary(_ report: OperationsReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(day == today ? "Today" : storeDayLabel(day, timezone: store.timezone, format: "EEEE d MMMM")).font(.headline)
                Spacer()
                if day != today { Button("Back to today") { date = Date() }.buttonStyle(.borderless).font(.subheadline.weight(.semibold)) }
            }
            StockFigures(showsOnHand: stock != nil && day == today, onHand: board?.onHand, made: report.made, wasted: report.wasted)
                .accessibilityIdentifier("waste-totals")
            if day == today, let board { UncountedNote(board: board) }
        }
        .padding(.vertical, 4)
    }
    private func pendingText(_ mutation: WasteMutation) -> String {
        switch mutation.action {
        case "record": "Not saved yet: \(mutation.quantity ?? 0) containers"
        case "edit": "Not saved yet: change to \(mutation.quantity ?? 0) containers"
        default: "Not saved yet: undo"
        }
    }
}

/// Sunday-to-Saturday strip; each day shows how many containers were wasted.
private struct WasteDayStrip: View {
    let day: String
    let today: String
    let timezone: String
    let week: OperationsReport?
    @Binding var date: Date
    let select: (String) -> Void
    var body: some View {
        let days = StoreDay.week(containing: day, timezone: timezone)
        let totals = Dictionary((week?.days ?? []).map { ($0.date, $0.wasted) }, uniquingKeysWith: { a, _ in a })
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, TimeZone(identifier: timezone) ?? .current)
                Spacer()
                Button { select(StoreDay.shift(day, by: -7, timezone: timezone)) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    .accessibilityLabel("Previous week")
                Button { select(min(StoreDay.shift(day, by: 7, timezone: timezone), today)) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                    .accessibilityLabel("Next week").disabled((days.last ?? today) >= today)
            }
            .buttonStyle(.borderless).font(.body.weight(.semibold))
            HStack(spacing: 6) {
                ForEach(days, id: \.self) { value in
                    let chosen = value == day
                    Button { select(value) } label: {
                        VStack(spacing: 3) {
                            Text(storeDayLabel(value, timezone: timezone, format: "EEEEE")).font(.caption2.weight(.semibold))
                                .foregroundStyle(chosen ? Theme.onAction.opacity(0.8) : .secondary)
                            Text(storeDayLabel(value, timezone: timezone, format: "d")).font(.headline).monospacedDigit()
                            Text(value > today ? " " : totals[value].map(String.init) ?? "–").font(.caption2).monospacedDigit()
                                .foregroundStyle(chosen ? Theme.onAction.opacity(0.8) : (totals[value] ?? 0) > 0 ? Theme.destructive : .secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .foregroundStyle(chosen ? Theme.onAction : Theme.action)
                        .background(chosen ? Theme.action : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                        .overlay(alignment: .top) { if value == today && !chosen { Capsule().fill(Theme.action).frame(width: 14, height: 3).padding(.top, 4) } }
                        .opacity(value > today ? 0.35 : 1)
                    }
                    .buttonStyle(.plain).disabled(value > today)
                    .accessibilityLabel("\(storeDayLabel(value, timezone: timezone, format: "EEEE d MMMM")), \(totals[value] ?? 0) wasted")
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Inline search → amount → reason → Log, without leaving the page.
private struct WasteQuickLog: View {
    let model: WasteLogModel
    let day: String
    let catalog: [OperationsReport.CatalogItem]
    @State private var query = ""
    @State private var product: OperationsReport.CatalogItem?
    @State private var quantity = ""
    @State private var reason: WasteReason = .expired
    @State private var note = ""
    @State private var addingNote = false
    @State private var logged: OperationsReport.Entry?
    @FocusState private var focus: Field?
    private enum Field { case search, quantity, note }
    private var locked: Bool { model.pending || model.busy }
    private var amount: Int? { Int(quantity).flatMap { (1...9999).contains($0) ? $0 : nil } }
    private var matches: [OperationsReport.CatalogItem] {
        let words = query.split(separator: " ")
        return catalog.filter { item in words.allSatisfy { item.product_name.localizedCaseInsensitiveContains($0) } }
    }
    var body: some View {
        if let product {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(product.product_name).font(.headline)
                    Text(product.family).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Change") { self.product = nil; focus = .search }.buttonStyle(.borderless).disabled(locked)
            }
            // A retried save that succeeds later still clears the form.
            .onChange(of: model.pending) { old, new in if old, !new, model.saved, model.report?.business_date == day { finish() } }
            WasteQuantityField(text: $quantity, focus: $focus, field: .quantity).disabled(locked)
            Picker("Reason", selection: $reason) { ForEach(WasteReason.allCases, id: \.self) { Text($0.label).tag($0) } }
                .pickerStyle(.segmented).disabled(locked)
            if addingNote || !note.isEmpty {
                TextField("Note (optional)", text: $note, axis: .vertical).focused($focus, equals: .note).disabled(locked)
                if note.count > 300 { Text("Keep notes under 300 characters.").font(.caption).foregroundStyle(Theme.destructive) }
            } else {
                Button { addingNote = true; focus = .note } label: { Label("Add note", systemImage: "text.bubble") }.buttonStyle(.borderless)
            }
            Button { Task { await log() } } label: {
                if model.busy { ProgressView() } else { Text(amount.map { "Log \($0) · \(product.product_name)" } ?? "Enter how many containers") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(amount == nil || note.count > 300 || locked)
            .accessibilityIdentifier("waste-log")
            .listRowSeparator(.hidden)
        } else {
            if let logged {
                HStack {
                    Label("Logged \(logged.quantity) · \(logged.product_name)", systemImage: "checkmark.circle.fill").font(.subheadline)
                    Spacer()
                    if logged.can_void, model.report?.entries.contains(where: { $0.id == logged.id && !$0.voided }) == true {
                        Button("Undo") { self.logged = nil; Task { await model.save(.undo(logged.id)) } }.buttonStyle(.borderless).disabled(locked)
                    }
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search product to log", text: $query)
                    .focused($focus, equals: .search)
                    .submitLabel(.next)
                    .onSubmit { if let first = matches.first { pick(first) } }
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("waste-search")
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.borderless).accessibilityLabel("Clear search") }
            }
            .disabled(locked)
            if query.isEmpty {
                NavigationLink {
                    WasteProductPicker(items: catalog, selected: Binding(get: { "" }, set: { id in if let item = catalog.first(where: { $0.id == id }) { pick(item) } }))
                } label: { Label("Browse all products", systemImage: "list.bullet") }
                .disabled(locked)
            } else {
                ForEach(matches.prefix(8)) { item in
                    Button { pick(item) } label: {
                        HStack { Text(item.product_name).foregroundStyle(Theme.action); Spacer(); Text(item.family).font(.caption).foregroundStyle(.secondary) }.contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).accessibilityLabel(item.product_name)
                }
                if matches.isEmpty { Text("No product matches “\(query)”.").foregroundStyle(.secondary) }
                if matches.count > 8 { Text("\(matches.count - 8) more — keep typing to narrow down.").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
    private func pick(_ item: OperationsReport.CatalogItem) {
        product = item; query = ""; quantity = ""; reason = .expired; note = ""; addingNote = false; logged = nil
        focus = .quantity
    }
    private func log() async {
        guard let product, let amount else { return }
        focus = nil
        await model.save(.record(product: product.id, quantity: amount, reason: reason, note: note, day: day))
        if model.saved { finish() }
    }
    private func finish() {
        guard let product else { return }
        logged = model.report?.entries.first { $0.product_id == product.id && !$0.voided }
        self.product = nil; quantity = ""; note = ""; addingNote = false
    }
}

/// Big number entry with − and + for quick adjustments.
private struct WasteQuantityField<Field: Hashable>: View {
    @Binding var text: String
    var focus: FocusState<Field?>.Binding
    let field: Field
    private var value: Int { Int(text) ?? 0 }
    var body: some View {
        HStack(spacing: 12) {
            step(-1, "minus").disabled(value <= 1)
            TextField("0", text: $text)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .multilineTextAlignment(.center)
                .font(.system(size: 34, weight: .semibold)).monospacedDigit()
                .focused(focus, equals: field)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
                .onChange(of: text) { _, new in let digits = String(new.filter(\.isASCII).filter(\.isNumber).prefix(4)); if digits != new { text = digits } }
                .accessibilityLabel("Containers wasted")
                .accessibilityIdentifier("waste-quantity")
                #if os(iOS)
                .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Close keyboard") { focus.wrappedValue = nil } } }
                #endif
            step(1, "plus").disabled(value >= 9999)
        }
        .buttonStyle(.borderless)
    }
    private func step(_ delta: Int, _ symbol: String) -> some View {
        Button { text = String(min(9999, max(1, value + delta))) } label: {
            Image(systemName: symbol).font(.title3.weight(.semibold)).frame(width: 52, height: 52)
                .background(Theme.field, in: Circle())
        }
        .accessibilityLabel(delta > 0 ? "One more" : "One less")
    }
}

private struct WasteEntryRow: View {
    let entry: OperationsReport.Entry
    let timezone: String
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.product_name).font(.headline)
                Text("\(entry.reason.label) · \(entry.actor_name) · \(time(entry.created_at))").font(.subheadline).foregroundStyle(.secondary)
                if !entry.note.isEmpty { Text(entry.note).font(.subheadline) }
            }
            Spacer()
            if entry.voided {
                VStack(alignment: .trailing, spacing: 4) {
                    Text("\(entry.quantity)").font(.title3.weight(.semibold)).monospacedDigit().strikethrough()
                    Pill(text: entry.edited == true ? "Corrected" : "Undone")
                }
            } else {
                Text("\(entry.quantity)").font(.title2.weight(.semibold)).monospacedDigit()
                if entry.can_void { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
    private func time(_ raw: String) -> String {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let value = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return raw }
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: timezone); formatter.dateStyle = .none; formatter.timeStyle = .short
        return formatter.string(from: value)
    }
}

/// Correct the amount, reason or note of an entry; the server keeps the original as history.
private struct WasteEditView: View {
    let model: WasteLogModel
    let entry: OperationsReport.Entry
    let timezone: String
    @State private var quantity: String
    @State private var reason: WasteReason
    @State private var note: String
    @State private var confirmUndo = false
    @FocusState private var focus: Bool?
    @Environment(\.dismiss) private var dismiss
    init(model: WasteLogModel, entry: OperationsReport.Entry, timezone: String) {
        self.model = model; self.entry = entry; self.timezone = timezone
        _quantity = State(initialValue: String(entry.quantity)); _reason = State(initialValue: entry.reason); _note = State(initialValue: entry.note)
    }
    private var locked: Bool { model.pending || model.busy }
    private var amount: Int? { Int(quantity).flatMap { (1...9999).contains($0) ? $0 : nil } }
    private var changed: Bool { amount != entry.quantity || reason != entry.reason || note != entry.note }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Product", value: entry.product_name)
                    LabeledContent("Day", value: storeDayLabel(entry.business_date, timezone: timezone, format: "EEE d MMM"))
                    LabeledContent("Logged by", value: entry.actor_name)
                }
                Section("Containers wasted") { WasteQuantityField(text: $quantity, focus: $focus, field: true) }
                Section("Reason") { Picker("Reason", selection: $reason) { ForEach(WasteReason.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented) }
                Section("Note") {
                    TextField("Optional", text: $note, axis: .vertical)
                    if note.count > 300 { Text("Keep notes under 300 characters.").font(.caption).foregroundStyle(Theme.destructive) }
                }
                if let error = model.error { Section { Text(error).foregroundStyle(Theme.destructive) } }
                Section {
                    Button("Undo entry", role: .destructive) { confirmUndo = true }
                } footer: { Text("Changes are kept in the history, so totals stay accurate.") }
            }
            .disabled(locked)
            .pageBackground()
            .safeAreaInset(edge: .bottom) {
                if model.pending { Button("Retry waste save") { Task { await model.retry(); if model.saved { dismiss() } } }.buttonStyle(PrimaryButtonStyle()).padding().disabled(model.busy) }
            }
            .navigationTitle("Edit waste")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(locked) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save(.edit(entry.id, quantity: amount ?? 0, reason: reason, note: note)) }
                        .disabled(amount == nil || !changed || note.count > 300 || locked)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .confirmationDialog("Undo this waste entry? Its history will remain.", isPresented: $confirmUndo, titleVisibility: .visible) {
                Button("Undo \(entry.quantity) · \(entry.product_name)", role: .destructive) { save(.undo(entry.id)) }
            }
        }
        .interactiveDismissDisabled(locked)
    }
    private func save(_ mutation: WasteMutation) {
        focus = nil
        Task { await model.save(mutation); if model.saved { dismiss() } }
    }
}

/// Week (or month) totals, a per-day chart and what was wasted most.
private struct WasteWeekSummary: View {
    let report: OperationsReport
    var selected: String?
    let timezone: String
    var select: ((String) -> Void)?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 28) {
                StatFigure(value: report.wasted, label: "wasted")
                StatFigure(value: report.made, label: "made")
                if let rate = wasteRate(report) { WasteRateFigure(rate: rate) }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("waste-period-totals")
            if let days = report.days, days.count > 1 { WasteDaysChart(days: days, selected: selected, timezone: timezone, select: select) }
            let top = Array(report.mostWasted.prefix(5))
            if !top.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow("Most wasted")
                    ForEach(top) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack { Text(item.product_name).font(.subheadline); Spacer(); Text("\(item.wasted)").font(.subheadline.weight(.semibold)).monospacedDigit() }
                            GeometryReader { geo in
                                Capsule().fill(Theme.destructive.opacity(0.75))
                                    .frame(width: max(6, geo.size.width * CGFloat(item.wasted) / CGFloat(max(top[0].wasted, 1))))
                            }
                            .frame(height: 5)
                            if item.made > 0 { Text("\(item.made) made · \(Int((Double(item.wasted) / Double(item.made) * 100).rounded()))% wasted").font(.caption).foregroundStyle(.secondary) }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if let reasons = report.reasons, !reasons.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("By reason")
                    HStack(spacing: 8) { ForEach(reasons) { item in Pill(text: "\(item.reason.label) \(item.wasted)") } }
                }
            }
            if report.wasted == 0 && report.made == 0 { Text("No preparation or waste recorded for this period.").font(.subheadline).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 6)
    }
}

private struct WasteDaysChart: View {
    let days: [OperationsReport.Day]
    var selected: String?
    let timezone: String
    var select: ((String) -> Void)?
    var body: some View {
        let short = days.count <= 7
        Chart(days) { item in
            BarMark(x: .value("Day", item.date), y: .value("Wasted", item.wasted))
                .foregroundStyle(item.date == selected ? Theme.destructive : Theme.destructive.opacity(0.4))
                .cornerRadius(4)
                .annotation(position: .top) { if short && item.wasted > 0 { Text("\(item.wasted)").font(.caption2).monospacedDigit().foregroundStyle(.secondary) } }
        }
        .chartXAxis {
            AxisMarks { value in
                if let raw = value.as(String.self), short || storeDayLabel(raw, timezone: timezone, format: "d").hasSuffix("1") || raw == days.last?.date {
                    AxisValueLabel(storeDayLabel(raw, timezone: timezone, format: short ? "EEE" : "d"))
                }
            }
        }
        .chartYAxis(.hidden)
        .chartOverlay { proxy in
            GeometryReader { _ in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onTapGesture { location in if let select, let value: String = proxy.value(atX: location.x) { select(value) } }
            }
        }
        .frame(height: 140)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(days.map { "\(storeDayLabel($0.date, timezone: timezone, format: "EEEE d")): \($0.wasted)" }.joined(separator: ", "))
    }
}

private struct WasteRateFigure: View {
    let rate: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(rate, format: .percent.precision(.fractionLength(0)))
                .font(.system(size: 40, weight: .semibold)).monospacedDigit()
                .minimumScaleFactor(0.6).lineLimit(1)
            Text("of made").font(.subheadline).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

private func wasteRate(_ report: OperationsReport) -> Double? { report.made > 0 ? Double(report.wasted) / Double(report.made) : nil }

/// Formats a `yyyy-MM-dd` store day, e.g. "EEE d MMM" → "Tue 7 Oct".
private func storeDayLabel(_ day: String, timezone: String, format: String) -> String {
    guard let date = StoreDay.date(day, timezone: timezone) else { return day }
    let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: timezone); formatter.setLocalizedDateFormatFromTemplate(format)
    if format.count <= 5 { formatter.dateFormat = format }
    return formatter.string(from: date)
}

private struct WasteProductPicker: View {
    let items: [OperationsReport.CatalogItem]
    @Binding var selected: String
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            ForEach(["Fruit", "Vegetables", "Salads"], id: \.self) { family in
                let rows = items.filter { $0.family == family && (query.isEmpty || $0.product_name.localizedCaseInsensitiveContains(query)) }
                if !rows.isEmpty { Section(family) { ForEach(rows) { item in Button(item.product_name) { selected = item.id; dismiss() } } } }
            }
        }.pageBackground().navigationTitle("Product").searchable(text: $query, prompt: "Product name")
    }
}


/// On hand, made and wasted: the same row on the home card and in the Waste Log.
struct StockFigures: View {
    var showsOnHand = true
    let onHand: Int?
    let made: Int?
    let wasted: Int?
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 24) {
            if showsOnHand { StatFigure(value: onHand, label: "on hand") }
            StatFigure(value: made, label: "made")
            StatFigure(value: wasted, label: "wasted")
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// On hand leaves out products that were never counted; say so.
struct UncountedNote: View {
    let board: PrepBoard
    var body: some View {
        if board.uncounted > 0 {
            Text("\(board.uncounted) product\(board.uncounted == 1 ? "" : "s") not counted yet").font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Large tabular number with a quiet label beneath, for at-a-glance totals.
struct StatFigure: View {
    let value: Int?
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value.map(String.init) ?? "—")
                .font(.system(size: 40, weight: .semibold)).monospacedDigit()
                .minimumScaleFactor(0.6).lineLimit(1)
            Text(label).font(.subheadline).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
