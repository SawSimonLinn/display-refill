import DisplayRefillCore
import SwiftUI
struct QuickStockView: View {
    let store: Me.Store
    let stockAPI: any StockUpdateAPI
    let userID: String
    @State private var model: PrepListModel
    @State private var section = ""
    @State private var search = ""
    @State private var selected: PrepItem?
    init(store: Me.Store, api: any PrepAPI, stockAPI: any StockUpdateAPI, userID: String) {
        self.store = store; self.stockAPI = stockAPI; self.userID = userID
        _model = State(initialValue: PrepListModel(api: api, storeID: store.id.uuidString))
    }
    var body: some View {
        List {
            Picker("Section", selection: $section) {
                Text("All sections").tag("")
                ForEach(ProductionSection.allCases) { Text($0.label).tag($0.rawValue) }
            }
            if let error = model.error { Text(error); Button("Retry") { Task { await model.refresh() } } }
            if let board = model.board {
                if board.items.isEmpty { Text("Complete your first section counts to enable quick updates.") }
                ForEach(board.items.filter { item in (section.isEmpty || item.locations.contains { $0.section.rawValue == section }) && (search.isEmpty || item.product_name.localizedCaseInsensitiveContains(search)) }.sorted { $0.product_name < $1.product_name }) { item in
                    Button { selected = item } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.product_name).font(.headline)
                            Text(item.locations.map { $0.section.label }.joined(separator: " · ")).font(.caption)
                        }.padding(.vertical, 6)
                    }.accessibilityIdentifier("quick-stock-\(item.id)")
                }
            } else if model.loading { ProgressView("Loading stock") }
        }
        .navigationTitle("Update Stock")
        .searchable(text: $search, prompt: "Find product")
        .task { await model.refresh() }
        .refreshable { await model.refresh() }
        .sheet(item: $selected, onDismiss: { Task { await model.refresh() } }) { item in
            NavigationStack { StockEditor(item: item, api: stockAPI, storeID: store.id.uuidString, userID: userID) }
        }
    }
}
private struct StockEditor: View {
    let item: PrepItem
    @State private var model: StockUpdateModel
    @FocusState private var focused: String?
    @Environment(\.dismiss) private var dismiss
    init(item: PrepItem, api: any StockUpdateAPI, storeID: String, userID: String) {
        self.item = item
        _model = State(initialValue: StockUpdateModel(api: api, storeID: storeID, persistenceKey: "stock.pending.\(userID).\(storeID).\(item.id)"))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(item.product_name).font(.title2.bold())
                Text("Last saved counts · edit to update stock").font(.caption).foregroundStyle(.secondary)
                ForEach(item.locations, id: \.section) { location in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(location.section.label).font(.headline)
                        Text("HAVE").font(.subheadline)
                        countField(location.section.rawValue, label: "Have, \(location.section.label)")

                    }
                }
                if let error = model.error { Text(error).foregroundStyle(.red) }
                Button(model.pending ? "Retry stock save" : "Save stock & update prep") { focused = nil; Task { await model.save(item); if model.saved { dismiss() } } }
                    .buttonStyle(.borderedProminent).disabled(model.busy || model.conflict)
                    .accessibilityIdentifier("quick-stock-save")
                if model.pending { Text("Keep this count open until the save is resolved.").font(.footnote) }
            }.padding()
        }
        .navigationTitle("Recount Product")
        .task { model.loadCounts(item) }
        .interactiveDismissDisabled(model.pending || model.busy)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(model.pending || model.busy) }
            #if os(iOS)
            ToolbarItemGroup(placement: .keyboard) {
                Button("Next item") {
                    let keys = item.locations.map { $0.section.rawValue }
                    if let index = keys.firstIndex(where: { $0 == focused }), index + 1 < keys.count { focused = keys[index + 1] } else { focused = nil }
                }
                Spacer(); Button("Done") { focused = nil }
            }
            #endif
        }
    }
    private func countField(_ key: String, label: String) -> some View {
        TextField("Not counted", text: Binding(get: { model.inputs[key] ?? "" }, set: { model.inputs[key] = $0 }))
            .textFieldStyle(.roundedBorder).disabled(model.pending || model.busy)
            #if os(iOS)
            .keyboardType(.numberPad)
            #endif
            .focused($focused, equals: key).accessibilityLabel(label).accessibilityIdentifier("quick-stock-input-\(key)")
    }
}
