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
    @AccessibilityFocusState private var errorFocused: Bool
    @FocusState private var focusedCountID: String?
    @ScaledMetric(relativeTo: .body) private var countHeight: CGFloat = 44
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    init(api: any ManualScanAPI, userID: String, display: ManualDisplay?, scanID: String?) {
        self.api = api; self.userID = userID; self.display = display; self.scanID = scanID
        _model = State(initialValue: ManualWorkflow(api: api))
    }
    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if model.busy { ProgressView("Contacting server…") }
                    if let message = model.message {
                        ManualSection("Action needed") {
                            Text(message).accessibilityFocused($errorFocused).manualTextLayout()
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
                        }.id("manual-error")
                    }
                    if let scan = model.scan {
                        ManualSection {
                            Text("Counts reflect this check.").manualTextLayout()
                            Text(scan.createdAt, style: .date).manualTextLayout()
                            Text(scan.createdAt, style: .time).manualTextLayout()
                            Text("Revision \(scan.revision) · \(scan.status)").manualTextLayout()
                        }
                        if model.reviewsEstimates { estimateSummary(scan) }
                        ManualSection("Pinned slots") {
                            if model.reviewsEstimates && scan.editable {
                                Text("Slots that need your check are listed first.").foregroundStyle(.secondary).manualTextLayout()
                            }
                            ForEach(model.orderedSlots) { slot in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(slot.productName).font(.headline).manualTextLayout()
                                    Text("Slot \(slot.slotLabel) · Target \(slot.target)").manualTextLayout()
                                    if let trigger = slot.refillThreshold { Text("Refill trigger: \(trigger) or fewer").manualTextLayout() }
                                    if model.reviewsEstimates {
                                        estimateDetails(slot, scan: scan)
                                    } else {
                                        Text(model.inputs[slot.id, default: ""] != (slot.acceptedQuantity.map(String.init) ?? "") ? "Unsaved physical count" : slot.reviewState == "verified" ? "Verified on server" : "Physical count required").manualTextLayout()
                                    }
                                    if scan.editable {
                                        TextField("Unknown", text: Binding(
                                            get: { model.inputs[slot.id, default: ""] },
                                            set: { model.inputs[slot.id] = $0 }
                                        ))
                                        .frame(minHeight: countHeight)
                                        .countKeyboard()
                                        .focused($focusedCountID, equals: slot.id)
                                        .disabled(model.hasPendingRequest)
                                        .accessibilityLabel("Count for \(slot.productName), slot \(slot.slotLabel)")
                                        let controls = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout())
                                        controls {
                                            Button("Decrease", systemImage: "minus.circle") { adjust(slot.id, by: -1) }
                                                .disabled((ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) ?? 0) == 0)
                                                .frame(minHeight: 44)
                                                .accessibilityLabel("Decrease count for slot \(slot.slotLabel)")
                                            if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                                            Button("Increase", systemImage: "plus.circle") { adjust(slot.id, by: 1) }
                                                .disabled(ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) == nil || ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) == 999)
                                                .frame(minHeight: 44)
                                                .accessibilityLabel("Increase count for slot \(slot.slotLabel)")
                                        }.disabled(model.hasPendingRequest).buttonStyle(ManualActionStyle()).frame(minHeight: 44)
                                        if ManualWorkflow.quantity(model.inputs[slot.id, default: ""]) == nil {
                                            Text("Enter an integer from 0 to 999; blank is unknown.").foregroundStyle(.secondary).manualTextLayout()
                                        }
                                        if model.canCheck(slot), let estimate = slot.acceptedQuantity {
                                            checkButton(slot, estimate: estimate)
                                        }
                                    } else {
                                        Text("Confirmed count: \(slot.acceptedQuantity.map(String.init) ?? "Unknown")").monospacedDigit().manualTextLayout()
                                    }
                                }.padding(.vertical, 4)
                            }
                        }
                        ManualSection(scan.editable ? "Unconfirmed server recommendations" : "Confirmed refill list") {
                            if model.dirty { Text("Entries changed. Save to update recommendations.").manualTextLayout() }
                            Text("Refill total: \((scan.totalRefill ?? scan.provisionalTotalRefill).map(String.init) ?? "Unknown")").monospacedDigit().manualTextLayout()
                            ForEach(scan.products) { product in
                                DisclosureGroup {
                                    ForEach(scan.slots.filter { $0.productID == product.id }) { slot in
                                        Text("Slot \(slot.slotLabel): Refill \(slot.refillQuantity.map(String.init) ?? "Unknown")").manualTextLayout()
                                    }
                                } label: {
                                    let name = scan.slots.first { $0.productID == product.id }?.productName ?? "Product"
                                let quantity = product.refillQuantity.map(String.init) ?? "Unknown"
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(name).manualTextLayout()
                                    Text("Refill \(quantity)").monospacedDigit().manualTextLayout()
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("\(name): Refill \(quantity)")
                                }
                            }
                        }
                        ManualSection {
                            if scan.editable {
                                Button(model.reviewsEstimates ? "Save checks and corrections" : "Save and review refill") { Task { await model.save(); remember() } }
                                    .disabled(!model.canSave)
                                Text(model.reviewsEstimates
                                     ? "Saving records each corrected count and each estimate you checked as verified by you. The original estimates are kept."
                                     : "Saving attests that you physically counted each entered slot.").manualTextLayout()
                                Button("Confirm counts and refill list") { confirming = true }
                                    .disabled(!model.canConfirm)
                                if !model.valid || !scan.unresolvedSlotIDs.isEmpty { Text("All counts must be entered, saved and verified before confirmation.").manualTextLayout() }
                            } else if scan.status == "confirmed" {
                                Button("Mark refill completed") { completing = true }
                                    .disabled(model.conflict || model.hasPendingRequest)
                            } else if let date = scan.completedAt {
                                Label("Employee attested refill completion", systemImage: "checkmark.circle").manualTextLayout()
                                Text(date, style: .date).manualTextLayout()
                                Text("Recorded by \(scan.completedBy ?? "employee"). Observed counts remain unchanged.").manualTextLayout()
                            }
                        }
                        if scan.status == "confirmed" || scan.status == "completed" { correctionGuidance }
                    } else if !model.busy, let display {
                        Button("Start manual check") { Task { await model.start(display: display); remember() } }
                        #if os(iOS)
                        if let photoAPI = api as? any PhotoScanAPI {
                            NavigationLink("Photo check") { PhotoCheckView(api: photoAPI, manualAPI: api, display: display, userID: userID) }
                        }
                        #endif
                        Text("Network is required. Each count starts unknown.").manualTextLayout()
                    }
                }
                .padding(16)
            }
            .onChange(of: model.message) { _, message in
                errorFocused = message != nil
                if message != nil {
                    focusedCountID = nil
                    reader.scrollTo("manual-error", anchor: .top)
                }
            }
        }
        #if os(iOS)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedCountID = nil }
            }
        }
        #endif
        .buttonStyle(ManualActionStyle())
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
    /// Photo-wide context for estimates: synthetic source, photo issues and what is left to check.
    private func estimateSummary(_ scan: ScanDetail) -> some View {
        ManualSection("Photo estimates") {
            if scan.analysis?.synthetic == true {
                Label("Test analysis: these estimates come from a synthetic test provider, not from your photo.", systemImage: "exclamationmark.triangle")
                    .manualTextLayout()
            }
            if let alignment = scan.analysis?.alignment, alignment != "good" {
                Text("We couldn't match this photo to the layout, so no slot has an estimate. Enter each count.").manualTextLayout()
            }
            if let flags = scan.analysis?.imageFlags, !flags.isEmpty {
                Text("Photo quality issues (\(flags.map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: ", "))) mean every slot needs your check.").manualTextLayout()
            }
            Text("Estimates are not counts until confirmed. For each slot that needs your check, confirm the estimate is right or enter the number you count.")
                .manualTextLayout()
            if scan.editable {
                let remaining = scan.unresolvedSlotIDs.count
                Text(remaining == 0 ? "No slots need your check." : "\(remaining) of \(scan.slots.count) slots need your check.")
                    .font(.headline).manualTextLayout()
                    .accessibilityIdentifier("review-remaining")
            }
        }
    }
    /// Original AI evidence beside the saved count, why review is needed, and verification status.
    @ViewBuilder private func estimateDetails(_ slot: ScanDetail.Slot, scan: ScanDetail) -> some View {
        Text("AI estimate: \(slot.aiQuantity.map(String.init) ?? "none")").monospacedDigit().manualTextLayout()
        if scan.editable {
            Text("Saved count: \(slot.acceptedQuantity.map(String.init) ?? "Unknown")").monospacedDigit().manualTextLayout()
        }
        ForEach(ReviewReason.reasons(for: slot, analysis: scan.analysis), id: \.self) { reason in
            Label(reason.explanation, systemImage: "exclamationmark.triangle").manualTextLayout()
        }
        let status: (String, String) = switch model.review(of: slot) {
        case .unsavedEdit: ("Unsaved correction", "pencil")
        case .checkedUnsaved: ("Checked. Save to record your check.", "checkmark.square")
        case .verified: ("Verified by a person", "checkmark.seal")
        case .needsVerification: ("Needs your check", "exclamationmark.circle")
        case .estimate: ("Estimate, not verified (optional check)", "circle.dashed")
        }
        Label(status.0, systemImage: status.1).font(.subheadline.weight(.semibold)).manualTextLayout()
            .accessibilityLabel("Status for slot \(slot.slotLabel): \(status.0)")
    }
    /// Checkbox semantics without a Toggle, whose label can clip at accessibility sizes.
    private func checkButton(_ slot: ScanDetail.Slot, estimate: Int) -> some View {
        let on = model.checked.contains(slot.id)
        return Button {
            model.setChecked(slot.id, !on)
        } label: {
            Label("I checked: \(estimate) is correct", systemImage: on ? "checkmark.square.fill" : "square")
        }
        .disabled(model.hasPendingRequest)
        .accessibilityLabel("Estimate \(estimate) for slot \(slot.slotLabel) is correct")
        .accessibilityValue(on ? "Checked" : "Not checked")
        .accessibilityAddTraits(.isToggle)
    }
    /// Confirmed counts are historical evidence; a mistake is corrected by a new check.
    private var correctionGuidance: some View {
        ManualSection("Found a mistake?") {
            Text("Confirmed counts can't be edited. To correct a mistake, start a new check of this display; this check stays as recorded.")
                .manualTextLayout()
            if let display {
                NavigationLink("Start a new check of this display") {
                    ManualCheckView(api: api, userID: userID, display: display, scanID: nil)
                }
            } else {
                Text("Open the display from your store's display list to start a new check.").manualTextLayout()
            }
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
    func manualTextLayout() -> some View {
        self.lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .layoutPriority(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    @ViewBuilder func countKeyboard() -> some View {
        #if os(iOS)
        self.keyboardType(.numberPad)
        #else
        self
        #endif
    }
}

/// Content-sized sections avoid table-row height constraints at accessibility sizes.
private struct ManualSection<Content: View>: View {
    let title: String?
    let content: Content
    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let title {
                Text(title).font(.headline).manualTextLayout()
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ManualActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.leading)
            .frame(minHeight: 44, alignment: .leading)
            .foregroundStyle(isEnabled ? Color.accentColor : Color.secondary)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
