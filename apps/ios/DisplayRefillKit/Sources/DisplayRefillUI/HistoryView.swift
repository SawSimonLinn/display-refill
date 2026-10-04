import DisplayRefillCore
import SwiftUI

/// Scan history for the stores this account is assigned to (Feature 11).
/// Content-sized rows in a scroll view, as on the count screen, so text
/// wraps at accessibility sizes instead of clipping inside table cells.
struct HistoryView: View {
    let stores: [Me.Store]
    let api: any ScanHistoryAPI
    let userID: String
    @State private var model: HistoryList
    @State private var selectedStore = ""

    init(stores: [Me.Store], api: any ScanHistoryAPI, userID: String) {
        self.stores = stores
        self.api = api
        self.userID = userID
        _model = State(initialValue: HistoryList(api: api))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if stores.count > 1 {
                    Picker("Store", selection: $selectedStore) {
                        Text("All my stores").tag("")
                        ForEach(stores) { Text($0.name).tag($0.storeID.uuidString.lowercased()) }
                    }
                    .pickerStyle(.menu)
                    .frame(minHeight: 44)
                    .accessibilityHint("Shows checks from one store or all your stores")
                }
                Text("Newest first. Refill numbers are shown only after counts are confirmed. “Refill marked done” is the employee’s statement, not a stock count.")
                    .font(.footnote).foregroundStyle(.secondary).historyText()
                content
            }
            .padding(16)
        }
        .background(Theme.surface)
        .navigationTitle("History")
        .task { await model.select(store: nil) }
        .refreshable { await model.reload() }
        .onChange(of: selectedStore) { _, store in Task { await model.select(store: store.isEmpty ? nil : store) } }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle:
            ProgressView("Loading history…").frame(maxWidth: .infinity, minHeight: 44)
        case .loading where model.items.isEmpty:
            ProgressView("Loading history…").frame(maxWidth: .infinity, minHeight: 44)
        case .signedOut:
            HistoryNotice(text: "Session expired. Sign in again.", systemImage: "person.crop.circle.badge.exclamationmark")
        case .failed(let message) where model.items.isEmpty:
            HistoryNotice(text: message, systemImage: "exclamationmark.triangle")
            Button("Try again") { Task { await model.reload() } }.historyButton()
        default:
            if case .failed(let message) = model.phase {
                HistoryNotice(text: "Couldn't refresh. \(message)", systemImage: "exclamationmark.triangle")
                Button("Try again") { Task { await model.reload() } }.historyButton()
            }
            if model.isEmpty {
                HistoryNotice(text: selectedStore.isEmpty ? "No checks yet in your stores." : "No checks yet in this store.", systemImage: "tray")
            }
            ForEach(model.items) { item in
                NavigationLink {
                    HistoryRecordView(api: api, userID: userID, scanID: item.scanID, title: item.display.name ?? "Check")
                } label: {
                    HistoryRow(item: item)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("history-row-\(item.scanID)")
            }
            footer
        }
    }

    @ViewBuilder private var footer: some View {
        if !model.items.isEmpty {
            Text(model.hasMore ? "Showing \(model.items.count) checks. More are available." : "All \(model.items.count) checks shown.")
                .font(.footnote).foregroundStyle(.secondary).historyText()
                .accessibilityIdentifier("history-count")
        }
        if let error = model.moreError {
            HistoryNotice(text: error, systemImage: "exclamationmark.triangle")
        }
        if model.hasMore {
            if model.loadingMore {
                ProgressView("Loading more…").frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Button(model.moreError == nil ? "Load more checks" : "Retry loading more") { Task { await model.loadMore() } }.historyButton()
            }
        }
    }
}

private struct HistoryRow: View {
    let item: ScanHistoryItem
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.display.name ?? "Display").font(.headline).historyText()
            Text(ScanStatusText.time(item.createdAt, timeZone: item.store.timezone)).historyText()
            Text("\(item.store.name ?? "Store") · \(item.pog.label)").font(.subheadline).foregroundStyle(.secondary).historyText()
            Label(ScanStatusText.label(item.status), systemImage: statusIcon).font(.subheadline.weight(.semibold)).historyText()
            Text(refillText).monospacedDigit().historyText()
            Text("\(ScanStatusText.source(item.source, takenOver: item.manualTakeover))\(item.createdByYou ? " · started by you" : "")").font(.subheadline).historyText()
            if item.syntheticAnalysis { Label("Synthetic test analysis", systemImage: "flask").font(.subheadline).historyText() }
            if item.imageState == "deleted" { Label("Photo removed (retention)", systemImage: "photo.badge.exclamationmark").font(.subheadline).historyText() }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.page, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the check record")
    }
    private var refillText: String {
        if let total = item.totalRefill { return item.completedAt == nil ? "Confirmed refill: \(total)" : "Confirmed refill: \(total) · marked done" }
        return "Not confirmed"
    }
    private var statusIcon: String {
        switch item.status {
        case "confirmed", "completed": "checkmark.circle"
        case "failed": "exclamationmark.octagon"
        case "needs_review": "pencil.circle"
        default: "clock"
        }
    }
}

/// One check's record: pinned layout, estimates beside counts, corrections,
/// and the confirmation and completion attestation in separate sections.
struct HistoryRecordView: View {
    let api: any ScanHistoryAPI
    let userID: String
    let title: String
    @State private var model: HistoryRecordModel

    init(api: any ScanHistoryAPI, userID: String, scanID: String, title: String) {
        self.api = api
        self.userID = userID
        self.title = title
        _model = State(initialValue: HistoryRecordModel(api: api, scanID: scanID))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch model.phase {
                case .loading where model.record == nil:
                    ProgressView("Loading check…").frame(maxWidth: .infinity, minHeight: 44)
                case .signedOut:
                    HistoryNotice(text: "Session expired. Sign in again.", systemImage: "person.crop.circle.badge.exclamationmark")
                case .failed(let message) where model.record == nil:
                    HistoryNotice(text: message, systemImage: "exclamationmark.triangle")
                    Button("Try again") { Task { await model.load() } }.historyButton()
                default:
                    if let record = model.record { recordContent(record) }
                }
            }
            .padding(16)
        }
        .background(Theme.surface)
        .navigationTitle(title)
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    @ViewBuilder private func recordContent(_ record: ScanRecord) -> some View {
        let scan = record.scan
        let tz = record.store.timezone
        HistorySection("Check") {
            Text("Started \(ScanStatusText.time(record.createdAt, timeZone: tz))").historyText()
            if let by = record.createdBy { Text("Started by: \(by.label)").historyText() }
            Text("Source: \(ScanStatusText.source(scan.source ?? "manual", takenOver: record.manualTakeover != nil))").historyText()
            Text("\(record.store.name ?? "Store") · \(record.display.name ?? "Display")").historyText()
            Text("Pinned layout: \(record.pog.label)").historyText()
            Label(ScanStatusText.label(scan.status), systemImage: "info.circle").font(.headline).historyText()
            Text("Product names, targets and triggers are the values pinned when this check started.").font(.footnote).foregroundStyle(.secondary).historyText()
        }
        if scan.analysis?.synthetic == true {
            HistoryNotice(text: "Test analysis: estimates come from a synthetic test provider, not from the photo.", systemImage: "flask")
        }
        if let confirmation = record.confirmation {
            HistorySection("Confirmed refill quantity") {
                Text("Refill \(confirmation.totalRefill)").font(.title2.weight(.semibold)).monospacedDigit().historyText()
                Text("Confirmed \(ScanStatusText.time(confirmation.confirmedAt, timeZone: tz)) by \(confirmation.confirmedBy?.label ?? "a team member").").historyText()
                Text("Counts reflect this check.").historyText()
            }
        } else {
            HistorySection("Provisional recommendation") {
                Text(scan.provisionalTotalRefill.map { "Refill \($0)" } ?? "Unknown").font(.title2.weight(.semibold)).monospacedDigit().historyText()
                Text("Not confirmed. \(scan.unresolvedSlotIDs.isEmpty ? "Counts are saved but not confirmed." : "\(scan.unresolvedSlotIDs.count) slots still need a count or a check.")").historyText()
                if scan.editable {
                    NavigationLink("Continue this check") {
                        ManualCheckView(api: api, userID: userID, display: nil, scanID: scan.scanID)
                    }.historyButton()
                }
            }
        }
        HistorySection("Completion attestation") {
            if let completion = record.completion {
                Label("Refill marked done", systemImage: "checkmark.circle").historyText()
                Text("\(completion.attestedBy?.label ?? "An employee") marked the refill done \(ScanStatusText.time(completion.attestedAt, timeZone: tz)). This is an attestation, not a new stock count.").historyText()
            } else {
                Text(scan.status == "confirmed" ? "Not marked done yet." : "Only confirmed checks can be marked done.").historyText()
            }
        }
        HistorySection("Slots") {
            ForEach(scan.slots) { slot in
                VStack(alignment: .leading, spacing: 4) {
                    Text(slot.productName).font(.headline).historyText()
                    Text("Slot \(slot.slotLabel) · Target \(slot.target)").historyText()
                    if scan.source == "photo" || slot.aiQuantity != nil {
                        Text("Original estimate: \(slot.aiQuantity.map(String.init) ?? "none")").monospacedDigit().historyText()
                    }
                    ForEach(ReviewReason.reasons(for: slot, analysis: scan.analysis), id: \.self) { reason in
                        Label(reason.explanation, systemImage: "exclamationmark.triangle").font(.subheadline).historyText()
                    }
                    Text("Accepted count: \(slot.acceptedQuantity.map(String.init) ?? "Unknown")").monospacedDigit().historyText()
                    if let final = slot.finalQuantity { Text("Confirmed count: \(final)").monospacedDigit().historyText() }
                    Text("\(record.confirmation == nil ? "Provisional refill" : "Refill"): \(slot.refillQuantity.map(String.init) ?? "Unknown")").monospacedDigit().historyText()
                    Text(slot.reviewState == "verified" ? "Verified by a person" : slot.reviewRequired == true ? "Review required, not verified" : "Not individually verified").font(.subheadline).historyText()
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
        HistorySection("Corrections and checks") {
            if record.corrections.isEmpty {
                Text("No counts were saved for this check.").historyText()
            }
            ForEach(record.corrections) { c in
                VStack(alignment: .leading, spacing: 4) {
                    Text("Slot \(c.slotLabel ?? "?"): \(c.previousQuantity.map(String.init) ?? "unknown") → \(c.correctedQuantity)").monospacedDigit().historyText()
                    Text("\(reasonText(c.reason)) · \(c.verified == true ? "verified" : c.verified == false ? "saved unverified" : "verification not recorded")").font(.subheadline).historyText()
                    Text("\(c.actor?.label ?? "A team member") · \(ScanStatusText.time(c.createdAt, timeZone: tz))").font(.footnote).foregroundStyle(.secondary).historyText()
                }
                .accessibilityElement(children: .combine)
            }
        }
        HistorySection("Photo") { photo }
    }

    @ViewBuilder private var photo: some View {
        switch model.photo {
        case .none:
            Text("No photo was stored for this check.").historyText()
        case .removed(let message):
            Label(message, systemImage: "photo.badge.exclamationmark").historyText()
                .accessibilityIdentifier("history-photo-removed")
        case .notLoaded, .loading:
            ProgressView("Loading photo…").frame(maxWidth: .infinity, minHeight: 44)
                .task { if model.photo == .notLoaded { await model.loadPhoto() } }
        case .shown(let url):
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Photo of the display taken for this check")
                case .failure:
                    Color.clear.frame(height: 1).onAppear { model.photoLinkFailed() }
                default:
                    ProgressView("Loading photo…").frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        case .failed(let message):
            HistoryNotice(text: message, systemImage: "exclamationmark.triangle")
            Button("Load photo again") { Task { await model.loadPhoto() } }.historyButton()
        }
    }

    private func reasonText(_ reason: String?) -> String {
        switch reason {
        case "count_corrected": "Estimate corrected"
        case "visibility_check": "Estimate checked as correct"
        case "wrong_product": "Product mismatch checked"
        case "manual_count": "Counted by hand"
        default: "No reason recorded"
        }
    }
}

private struct HistoryNotice: View {
    let text: String
    let systemImage: String
    var body: some View {
        Label(text, systemImage: systemImage).historyText()
            .padding(16)
            .background(Theme.page, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct HistorySection<Content: View>: View {
    let title: String
    let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).historyText().accessibilityAddTraits(.isHeader)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.page, in: RoundedRectangle(cornerRadius: 12))
    }
}

private extension View {
    func historyText() -> some View {
        self.lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    func historyButton() -> some View {
        self.frame(minHeight: 44, alignment: .leading)
            .multilineTextAlignment(.leading)
    }
}
