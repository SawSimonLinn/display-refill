import DisplayRefillCore
import SwiftUI

struct OperationsSummaryView: View {
    let store: Me.Store
    let api: any OperationsAPI
    @State private var report: OperationsReport?
    @State private var error: String?
    @Environment(\.scenePhase) private var phase
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(report.map { "\($0.made) made" } ?? "— made", systemImage: "shippingbox")
                Spacer()
                Label(report.map { "\($0.wasted) wasted" } ?? "— wasted", systemImage: "trash")
            }.font(.headline).accessibilityIdentifier("operations-today")
            NavigationLink("Today’s made & waste") { OperationsReportView(store: store, api: api) }
            if let error { Text(error).font(.caption).foregroundStyle(.orange) }
        }.padding(12).background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                do { report = try await api.operations(storeID: store.id.uuidString, day: nil, period: "day"); error = nil }
                catch { report = nil; self.error = HistoryFailure.message(error) }
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
                Text("\(report.start_date) – \(report.end_date)").font(.caption)
                HStack { Text("Made: \(report.made)"); Spacer(); Text("Wasted: \(report.wasted)") }.font(.headline)
                ForEach(report.products.filter { $0.made > 0 || $0.wasted > 0 }) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.product_name).font(.headline)
                        HStack { Text("\(item.made) made"); Spacer(); Text("\(item.wasted) wasted") }.font(.subheadline)
                    }
                }
                if report.made == 0 && report.wasted == 0 { Text("No preparation or waste recorded for this period.") }
            } else if error == nil { ProgressView() }
            if let error { Text(error).foregroundStyle(.red) }
        }.navigationTitle("Made & Waste")
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
    let userID: String
    @State private var selected = ""
    @State private var locked = false
    var body: some View {
        Group {
            if let store = stores.first(where: { $0.id.uuidString == selected }) {
                WasteStoreView(store: store, api: api, userID: userID, lockStore: { locked = $0 }).id(selected)
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
    let lockStore: (Bool) -> Void
    @State private var model: WasteLogModel
    @State private var date = Date()
    @State private var adding = false
    @State private var undo: OperationsReport.Entry?
    @Environment(\.scenePhase) private var phase
    init(store: Me.Store, api: any OperationsAPI, userID: String, lockStore: @escaping (Bool) -> Void) {
        self.store = store; self.lockStore = lockStore
        _model = State(initialValue: WasteLogModel(api: api, storeID: store.id.uuidString, persistenceKey: "waste.pending.\(userID).\(store.id.uuidString)"))
    }
    private var day: String { StoreDay.string(date, timezone: store.timezone) }
    var body: some View {
        List {
            DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                .environment(\.timeZone, TimeZone(identifier: store.timezone) ?? .current).disabled(model.pending || model.busy)
            if let error = model.error { Text(error).foregroundStyle(.red) }
            if model.pending {
                if let mutation = model.pendingMutation { Text(mutation.action == "record" ? "Pending waste: \(mutation.quantity ?? 0) containers" : "Pending undo") }
                Button("Retry waste save") { Task { await model.retry() } }.disabled(model.busy)
            }
            if model.loading && model.report == nil { ProgressView("Loading waste log") }
            if let report = model.report {
                HStack { Text("\(report.made) made"); Spacer(); Text("\(report.wasted) wasted") }.font(.headline).accessibilityIdentifier("waste-totals")
                if report.entries.isEmpty { Text("No waste recorded. Log containers when you throw them away.") }
                ForEach(report.entries) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) { Text(entry.product_name).font(.headline); Spacer(); Text(entry.voided ? "Undone" : "\(entry.quantity)").font(.headline) }
                        Text("\(entry.reason.label) · \(entry.actor_name)").font(.subheadline)
                        Text(time(entry.created_at)).font(.caption).foregroundStyle(.secondary)
                        if !entry.note.isEmpty { Text(entry.note).font(.subheadline) }
                        if entry.can_void { Button("Undo entry", role: .destructive) { undo = entry }.disabled(model.pending || model.busy) }
                    }.accessibilityIdentifier("waste-entry-\(entry.id)")
                }
                if report.entries.count == 200 { Text("Showing the latest 200 entries for this date.").font(.caption) }
            }
            if model.error != nil && !model.pending { Button("Reload") { Task { await model.load(day: day) } } }
        }
        .navigationTitle("Waste Log")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .tint(.green)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { adding = true } label: { Label("Log waste", systemImage: "plus") }.disabled(model.report == nil || model.pending || model.busy) } }
        .refreshable { await model.load(day: day) }
        .task(id: day + String(describing: phase)) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.load(day: day)
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .onChange(of: model.pending || model.busy) { _, value in lockStore(value) }
        .sheet(isPresented: $adding) {
            WasteEntryView(model: model, day: day)
        }
        .confirmationDialog("Undo this waste entry? Its history will remain.", isPresented: Binding(get: { undo != nil }, set: { if !$0 { undo = nil } }), titleVisibility: .visible) {
            if let undo { Button("Undo \(undo.quantity) · \(undo.product_name)", role: .destructive) { self.undo = nil; Task { await model.save(.undo(undo.id)) } } }
        }
    }
    private func time(_ raw: String) -> String {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let value = parser.date(from: raw) else { return raw }
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: store.timezone); formatter.dateStyle = .short; formatter.timeStyle = .short
        return formatter.string(from: value)
    }
}
private struct WasteEntryView: View {
    let model: WasteLogModel
    let day: String
    @State private var selected = ""
    @State private var quantity = ""
    @State private var reason: WasteReason = .expired
    @State private var note = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            Form {
                NavigationLink {
                    WasteProductPicker(items: model.report?.catalog ?? [], selected: $selected)
                } label: { Text(model.report?.catalog.first(where: { $0.id == selected })?.product_name ?? "Choose product") }
                TextField("Containers wasted", text: $quantity)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .focused($focused).accessibilityIdentifier("waste-quantity")
                Picker("Reason", selection: $reason) { ForEach(WasteReason.allCases, id: \.self) { Text($0.label).tag($0) } }
                TextField("Note (optional)", text: $note, axis: .vertical)
                Text(day).font(.caption)
                Text("After discarding stock, update HAVE in Stock Check.").font(.footnote)
                if let error = model.error { Text(error).foregroundStyle(.red) }
            }.disabled(model.pending || model.busy)
                .safeAreaInset(edge: .bottom) {
                    if model.pending { Button("Retry waste save") { Task { await model.retry(); if model.saved { dismiss() } } }.buttonStyle(.borderedProminent).padding().disabled(model.busy) }
                }
                .navigationTitle("Log Waste")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(model.pending || model.busy) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { focused = false; Task { await model.save(.record(product: selected, quantity: Int(quantity) ?? 0, reason: reason, note: note, day: day)); if model.saved { dismiss() } } }
                            .disabled(selected.isEmpty || !ProductionWorksheet.valid(quantity) || (Int(quantity) ?? 0) < 1 || note.count > 300 || model.pending || model.busy)
                    }
                    #if os(iOS)
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Close keyboard") { focused = false } }
                    #endif
                }
        }.interactiveDismissDisabled(model.pending || model.busy)
    }
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
        }.navigationTitle("Product").searchable(text: $query, prompt: "Product name")
    }
}
