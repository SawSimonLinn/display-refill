import DisplayRefillCore
import SwiftUI

struct DisplaySelectionView: View {
    let store: Me.Store
    let api: any ManualScanAPI
    let userID: String
    @State private var displays: [ManualDisplay] = []
    @State private var loading = true
    @State private var error: String?
    var body: some View {
        List {
            if loading { ProgressView("Loading displays…") }
            if let error {
                Text(error)
                Button("Retry") { Task { await load() } }
            } else if !loading && displays.isEmpty {
                Text("No active displays. Ask your manager to add one.")
            }
            ForEach(displays) { display in
                if display.activePog == nil {
                    VStack(alignment: .leading) {
                        Text(display.name)
                        Text("No published POG assigned").foregroundStyle(.secondary)
                    }
                } else {
                    NavigationLink(display.name) {
                        ManualCheckView(api: api, userID: userID, display: display, scanID: nil)
                    }
                }
            }
        }
        .navigationTitle(store.name)
        .task { await load() }
        .refreshable { await load() }
    }
    private func load() async {
        loading = true
        defer { loading = false }
        do { displays = try await api.displays(store: store.storeID.uuidString); error = nil }
        catch {
            switch error as? APIClientError {
            case .signedOut: self.error = "Session expired. Sign in again."
            case .server(_, .forbidden, _, _), .server(_, .notFound, _, _):
                self.error = "Permission denied. Ask your manager to check your store assignment."
            default: self.error = "Unable to load displays. Check your connection and retry."
            }
        }
    }
}

struct SavedChecksView: View {
    let api: any ManualScanAPI
    let userID: String
    @AppStorage("manualSavedChecks") private var saved = ""
    var body: some View {
        List {
            let ids = saved.split(separator: "\n").map(String.init).filter { $0.hasPrefix(userID + "|") }
            if ids.isEmpty { Text("No saved manual checks on this device.") }
            ForEach(ids, id: \.self) { entry in
                let id = String(entry.dropFirst(userID.count + 1))
                NavigationLink("Check \(id.prefix(8))") {
                    ManualCheckView(api: api, userID: userID, display: nil, scanID: id)
                }
            }
        }.navigationTitle("Saved checks")
    }
}

struct ManualCheckView: View {
    let api: any ManualScanAPI
    let userID: String
    let display: ManualDisplay?
    let scanID: String?
    @State private var model: ManualWorkflow
    @AppStorage("manualSavedChecks") private var saved = ""
    @State private var confirming = false
    @State private var completing = false
    init(api: any ManualScanAPI, userID: String, display: ManualDisplay?, scanID: String?) {
        self.api = api; self.userID = userID; self.display = display; self.scanID = scanID
        _model = State(initialValue: ManualWorkflow(api: api))
    }
    var body: some View {
        Form {
            if model.busy { ProgressView("Contacting server…") }
            if let message = model.message {
                Section("Action needed") {
                    Text(message)
                    if model.conflict, let scan = model.scan {
                        Button("Reload latest and retain my entries") { Task { await model.load(id: scan.scanID, preserve: true) } }
                    } else {
                        if model.hasPendingRequest {
                            Button("Retry pending request") { Task { await model.retry(); remember() } }
                        }
                        if let id = model.scan?.scanID ?? scanID {
                            Button("Reload saved detail and retain my entries") { Task { await model.load(id: id, preserve: true) } }
                        }
                    }
                }
            }
            if let scan = model.scan {
                Section {
                    Text("Counts reflect this check.")
                    Text(scan.createdAt, style: .date)
                    Text(scan.createdAt, style: .time)
                    Text("Revision \(scan.revision) · \(scan.status)")
                }
                Section("Pinned slots") {
                    ForEach(scan.slots) { slot in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(slot.productName).font(.headline)
                            Text("Slot \(slot.slotLabel) · Target \(slot.target)")
                            if let trigger = slot.refillThreshold { Text("Refill trigger: \(trigger) or fewer") }
                            Text(model.inputs[slot.id, default: ""] != (slot.acceptedQuantity.map(String.init) ?? "") ? "Unsaved physical count" : slot.reviewState == "verified" ? "Verified on server" : "Physical count required")
                            if scan.editable {
                                TextField("Count (unknown until entered)", text: Binding(
                                    get: { model.inputs[slot.id, default: ""] },
                                    set: { model.inputs[slot.id] = $0 }
                                ))
                                .frame(minHeight: 44)
                                .countKeyboard()
                                .disabled(model.hasPendingRequest)
                                .accessibilityLabel("Count for \(slot.productName), slot \(slot.slotLabel)")
                                HStack {
                                    Button("Decrease", systemImage: "minus.circle") { adjust(slot.id, by: -1) }
                                        .disabled((ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) ?? 0) == 0)
                                        .frame(minHeight: 44)
                                        .accessibilityLabel("Decrease count for slot \(slot.slotLabel)")
                                    Spacer()
                                    Button("Increase", systemImage: "plus.circle") { adjust(slot.id, by: 1) }
                                        .disabled(ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) == nil || ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) == 999)
                                        .frame(minHeight: 44)
                                        .accessibilityLabel("Increase count for slot \(slot.slotLabel)")
                                }.disabled(model.hasPendingRequest).buttonStyle(.borderless).frame(minHeight: 44)
                                if ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) == nil {
                                    Text("Enter an integer from 0 to 999; blank is unknown.").foregroundStyle(.secondary)
                                }
                            } else {
                                Text("Confirmed count: \(slot.acceptedQuantity.map(String.init) ?? "Unknown")").monospacedDigit()
                            }
                        }.padding(.vertical, 4)
                    }
                }
                Section(scan.editable ? "Unconfirmed server recommendations" : "Confirmed refill list") {
                    if model.dirty { Text("Entries changed. Save to update recommendations.") }
                    Text("Refill total: \((scan.totalRefill ?? scan.provisionalTotalRefill).map(String.init) ?? "Unknown")").monospacedDigit()
                    ForEach(scan.products) { product in
                        DisclosureGroup {
                            ForEach(scan.slots.filter { $0.productID == product.id }) { slot in
                                Text("Slot \(slot.slotLabel): Refill \(slot.refillQuantity.map(String.init) ?? "Unknown")")
                            }
                        } label: {
                            Text("\(scan.slots.first { $0.productID == product.id }?.productName ?? "Product"): Refill \(product.refillQuantity.map(String.init) ?? "Unknown")")
                        }
                    }
                }
                Section {
                    if scan.editable {
                        Button("Save and review refill") { Task { await model.save(); remember() } }
                            .disabled(!model.valid || model.conflict || model.hasPendingRequest)
                        Text("Saving attests that you physically counted each entered slot.")
                        Button("Confirm counts and refill list") { confirming = true }
                            .disabled(!model.valid || model.dirty || !scan.unresolvedSlotIDs.isEmpty || model.conflict || model.hasPendingRequest)
                        if !model.valid || !scan.unresolvedSlotIDs.isEmpty { Text("All counts must be entered, saved and verified before confirmation.") }
                    } else if scan.status == "confirmed" {
                        Button("Mark refill completed") { completing = true }
                            .disabled(model.conflict || model.hasPendingRequest)
                    } else if let date = scan.completedAt {
                        Label("Employee attested refill completion", systemImage: "checkmark.circle")
                        Text(date, style: .date)
                        Text("Recorded by \(scan.completedBy ?? "employee"). Observed counts remain unchanged.")
                    }
                }
            } else if !model.busy, let display {
                Button("Start manual check") { Task { await model.start(display: display); remember() } }
                Text("Network is required. Each count starts unknown.")
            }
        }
        .disabled(model.busy)
        .navigationTitle(display?.name ?? "Manual check")
        .task { if let scanID { await model.load(id: scanID) } }
        .confirmationDialog("Confirm these saved counts and the server refill list? Counts become immutable.", isPresented: $confirming, titleVisibility: .visible) {
            Button("Confirm counts") { Task { await model.confirm(); remember() } }
        }
        .confirmationDialog("Attest that you completed the refill? This does not record a new stock check.", isPresented: $completing, titleVisibility: .visible) {
            Button("Mark refill completed") { Task { await model.complete(); remember() } }
        }
    }
    private func adjust(_ id: String, by delta: Int) {
        guard let n = ManualWorkflow.quantity(model.inputs[id, default: ""]) else { return }
        model.inputs[id] = String(max(0, min(999, n + delta)))
    }
    private func remember() {
        guard let id = model.scan?.scanID else { return }
        let entry = userID + "|" + id
        var entries = saved.split(separator: "\n").map(String.init)
        if !entries.contains(entry) { entries.append(entry); saved = entries.joined(separator: "\n") }
    }
}
private extension View {
    @ViewBuilder func countKeyboard() -> some View {
        #if os(iOS)
        self.keyboardType(.numberPad)
        #else
        self
        #endif
    }
}
