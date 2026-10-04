import Foundation
import Observation

public struct ScanDetail: Decodable, Sendable {
    public struct Slot: Decodable, Sendable, Identifiable {
        public var id: String { slotID }
        public let slotID: String
        public let productID: String
        public let productName: String
        public let slotLabel: String
        public let target: Int
        public let refillThreshold: Int?
        public let acceptedQuantity: Int?
        public let reviewState: String
        public let refillQuantity: Int?
        /// Original AI observation (photo scans); nil means unknown or not analysed, never zero.
        public let aiQuantity: Int?
        public let reviewRequired: Bool?
        /// Self-reported, uncalibrated model confidence; nil when none was reported.
        public let confidence: Double?
        public let flags: [String]?
        /// Frozen at confirmation; nil before it.
        public let finalQuantity: Int?
        enum CodingKeys: String, CodingKey {
            case target, confidence, flags, finalQuantity = "final_quantity"
            case slotID = "slot_id", productID = "product_id", productName = "product_name"
            case slotLabel = "slot_label", refillThreshold = "refill_threshold"
            case acceptedQuantity = "accepted_quantity", reviewState = "review_state", refillQuantity = "refill_quantity"
            case aiQuantity = "ai_quantity", reviewRequired = "review_required"
        }
    }
    /// Server analysis state for polling (Feature 09). Absent from older servers.
    public struct Analysis: Decodable, Sendable, Equatable {
        public let generation: Int
        public let failureCode: String?
        public let retryAvailable: Bool
        public let retriesRemaining: Int
        public let alignment: String?
        public let imageFlags: [String]
        public let provider: String?
        /// Deterministic mock output: not a reading of the actual photo.
        public let synthetic: Bool
        enum CodingKeys: String, CodingKey {
            case generation, alignment, provider, synthetic
            case failureCode = "failure_code", retryAvailable = "retry_available", retriesRemaining = "retries_remaining", imageFlags = "image_flags"
        }
    }
    public struct Product: Decodable, Sendable, Identifiable {
        public var id: String { productID }
        public let productID: String
        public let refillQuantity: Int?
        enum CodingKeys: String, CodingKey { case productID = "product_id", refillQuantity = "refill_quantity" }
    }
    public let scanID: String
    public let status: String
    public let revision: Int
    public let createdAt: Date
    public let completedAt: Date?
    public let completedBy: String?
    public let slots: [Slot]
    public let products: [Product]
    public let unresolvedSlotIDs: [String]
    public let provisionalTotalRefill: Int?
    public let totalRefill: Int?
    public let source: String?
    public let analysis: Analysis?
    public var editable: Bool { status == "needs_review" }
    enum CodingKeys: String, CodingKey {
        case status, revision, slots, products, source, analysis
        case scanID = "scan_id", createdAt = "created_at", completedAt = "completed_at", completedBy = "completed_by"
        case unresolvedSlotIDs = "unresolved_slot_ids", provisionalTotalRefill = "provisional_total_refill", totalRefill = "total_refill"
    }
}
/// Why the server routed a slot to review, in plain language. Explanations
/// describe what the photo could not establish; they never assert product identity.
public enum ReviewReason: String, CaseIterable, Sendable {
    case noEstimate, noConfidence, wrongProduct, occluded, outOfFrame, ambiguous, lowVisibility, photoIssue, lowConfidence
    public var explanation: String {
        switch self {
        case .noEstimate: "No estimate. Enter the number you count."
        case .noConfidence: "The estimate came without a confidence rating. Check it."
        case .wrongProduct: "The photo may show a different product here. Check the labels yourself; the photo can't confirm which product this is."
        case .occluded: "Units may be hidden behind others. Count by hand; the photo can't show hidden stock."
        case .outOfFrame: "Part of this slot is outside the photo."
        case .ambiguous: "The photo was unclear for this slot."
        case .lowVisibility: "This slot was hard to see in the photo."
        case .photoIssue: "A photo or alignment issue affects every slot."
        case .lowConfidence: "Low-confidence estimate. Check it."
        }
    }
    /// The server decides `review_required`; this only explains it. Slot flags come first,
    /// then missing values; otherwise a photo-wide issue or low confidence caused it.
    public static func reasons(for slot: ScanDetail.Slot, analysis: ScanDetail.Analysis?) -> [ReviewReason] {
        guard slot.reviewRequired == true else { return [] }
        let byFlag: [String: ReviewReason] = ["wrong_product": .wrongProduct, "occluded": .occluded, "out_of_frame": .outOfFrame, "ambiguous": .ambiguous, "low_visibility": .lowVisibility]
        var reasons = (slot.flags ?? []).compactMap { byFlag[$0] }
        if slot.aiQuantity == nil { reasons.append(.noEstimate) } else if slot.confidence == nil { reasons.append(.noConfidence) }
        let photoIssue = !(analysis?.imageFlags.isEmpty ?? true) || (analysis?.alignment.map { $0 != "good" } ?? false)
        if photoIssue { reasons.append(.photoIssue) }
        if reasons.isEmpty { reasons.append(.lowConfidence) }
        return reasons
    }
}
public struct ManualDisplay: Decodable, Sendable, Identifiable {
    public var id: String { displayID }
    public let displayID: String
    public let name: String
    public let activePog: Pog?
    public struct Pog: Decodable, Sendable {
        public let versionID: String
        enum CodingKeys: String, CodingKey { case versionID = "pog_version_id" }
    }
    enum CodingKeys: String, CodingKey { case name, displayID = "display_id", activePog = "active_pog" }
}
public struct DisplayPage: Decodable, Sendable {
    public let items: [ManualDisplay]
    public let nextCursor: String?
    enum CodingKeys: String, CodingKey { case items, nextCursor = "next_cursor" }
}
public protocol ManualScanAPI: Sendable {
    func displays(store: String) async throws -> [ManualDisplay]
    func detail(id: String) async throws -> ScanDetail
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail
}
extension URLSessionAccountAPI: ManualScanAPI {
    public func displays(store: String) async throws -> [ManualDisplay] {
        var items: [ManualDisplay] = []
        var cursor: String?
        repeat {
            let suffix = cursor.map { "&cursor=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)" } ?? ""
            // The authenticated transport resolves this relative URL, including its query.
            let page: DisplayPage = try await authorizedRequest("api/v1/stores/\(store)/displays?limit=100\(suffix)")
            items += page.items
            cursor = page.nextCursor
        } while cursor != nil
        return items
    }
    public func detail(id: String) async throws -> ScanDetail { try await authorizedRequest("api/v1/scans/\(id)") }
    public func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail {
        try await authorizedRequest(path, method: method, body: body, key: key)
    }
}

private struct CreateManualRequest: Encodable {
    let displayID: String
    let source = "manual"
    let expectedPogVersionID: String
    enum CodingKeys: String, CodingKey {
        case source, displayID = "display_id", expectedPogVersionID = "expected_pog_version_id"
    }
}
private struct RevisionRequest: Encodable {
    let expectedRevision: Int
    enum CodingKeys: String, CodingKey { case expectedRevision = "expected_revision" }
}
private struct CountRequest: Encodable {
    struct Item: Encodable {
        let slotID: String
        let quantity: Int
        var verified = true
        var reason = "manual_count"
        enum CodingKeys: String, CodingKey { case quantity, verified, reason, slotID = "slot_id" }
    }
    let expectedRevision: Int
    let items: [Item]
    enum CodingKeys: String, CodingKey { case items, expectedRevision = "expected_revision" }
}
/// In-memory edits only. Failed requests retain their exact bytes and key.
@MainActor @Observable
public final class ManualWorkflow {
    public private(set) var scan: ScanDetail?
    public var inputs: [String: String] = [:]
    public private(set) var busy = false
    public private(set) var message: String?
    public private(set) var conflict = false
    private let api: any ManualScanAPI
    private var pending: (String, String, Data, String)?
    /// Unchanged estimates the person explicitly checked; unsaved until `save()`.
    public private(set) var checked: Set<String> = []
    public init(api: any ManualScanAPI) { self.api = api }
    public var hasPendingRequest: Bool { pending != nil }
    /// Photo scans in review show AI estimates that need explicit verification.
    /// Manual and taken-over scans keep the Feature 07 physical-count flow.
    public var reviewsEstimates: Bool { scan?.source == "photo" }
    public var dirty: Bool {
        guard let scan else { return false }
        return scan.slots.contains { changed($0) || pendingCheck($0) }
    }
    public var valid: Bool {
        guard let scan else { return false }
        // Blank stays unknown only where the server value is already unknown; the API cannot clear a count.
        if reviewsEstimates { return scan.slots.allSatisfy { !changed($0) || Self.quantity(inputs[$0.id, default: ""]) != nil } }
        return scan.slots.allSatisfy { Self.quantity(inputs[$0.id, default: ""]) != nil }
    }
    public var canSave: Bool {
        guard let scan, scan.editable, valid, !conflict, pending == nil else { return false }
        return !reviewsEstimates || !reviewItems(scan).isEmpty
    }
    public var canConfirm: Bool {
        guard let scan, scan.editable, valid, !dirty, !conflict, pending == nil else { return false }
        return scan.unresolvedSlotIDs.isEmpty
    }
    /// Server-unresolved slots first, each group in the server's pinned order. Ordering
    /// follows saved state only, so rows never move while someone is typing.
    public var orderedSlots: [ScanDetail.Slot] {
        guard let scan else { return [] }
        let unresolved = Set(scan.unresolvedSlotIDs)
        return scan.slots.filter { unresolved.contains($0.id) } + scan.slots.filter { !unresolved.contains($0.id) }
    }
    public enum SlotReview: Equatable, Sendable {
        case unsavedEdit, checkedUnsaved, verified, needsVerification, estimate
    }
    public func review(of slot: ScanDetail.Slot) -> SlotReview {
        if changed(slot) { return .unsavedEdit }
        if pendingCheck(slot) { return .checkedUnsaved }
        if slot.reviewState == "verified" { return .verified }
        return scan?.unresolvedSlotIDs.contains(slot.id) == true ? .needsVerification : .estimate
    }
    /// An unchanged, known, unverified estimate can be explicitly accepted.
    public func canCheck(_ slot: ScanDetail.Slot) -> Bool {
        reviewsEstimates && scan?.editable == true && !changed(slot) && slot.acceptedQuantity != nil && slot.reviewState != "verified"
    }
    public func setChecked(_ slotID: String, _ on: Bool) {
        guard pending == nil else { return }
        if on { checked.insert(slotID) } else { checked.remove(slotID) }
    }
    private func changed(_ slot: ScanDetail.Slot) -> Bool {
        inputs[slot.id, default: ""] != (slot.acceptedQuantity.map(String.init) ?? "")
    }
    private func pendingCheck(_ slot: ScanDetail.Slot) -> Bool { checked.contains(slot.id) && canCheck(slot) }
    /// Only changed counts and explicit checks are sent; untouched estimates stay unverified.
    private func reviewItems(_ scan: ScanDetail) -> [CountRequest.Item] {
        scan.slots.compactMap { slot in
            let flagged = slot.flags?.contains("wrong_product") == true
            if pendingCheck(slot), let quantity = slot.acceptedQuantity {
                return CountRequest.Item(slotID: slot.id, quantity: quantity, reason: flagged ? "wrong_product" : "visibility_check")
            }
            guard changed(slot), let quantity = Self.quantity(inputs[slot.id, default: ""]) else { return nil }
            return CountRequest.Item(slotID: slot.id, quantity: quantity, reason: flagged ? "wrong_product" : slot.aiQuantity == nil ? "manual_count" : "count_corrected")
        }
    }
    public nonisolated static func quantity(_ text: String) -> Int? {
        guard !text.isEmpty, text.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(text), (0...999).contains(n) else { return nil }
        return n
    }
    public func load(id: String, preserve: Bool = false) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let latest = try await api.detail(id: id)
            scan = latest
            if !preserve {
                inputs = Dictionary(uniqueKeysWithValues: latest.slots.map { ($0.id, $0.acceptedQuantity.map(String.init) ?? "") })
                checked = []
            }
            pending = nil
            conflict = false
            message = preserve ? "Latest revision loaded. Your entries are retained; review them before saving over the latest counts." : nil
        } catch { report(error) }
    }
    public func start(display: ManualDisplay) async {
        guard let pog = display.activePog else { message = "No published POG. Ask your manager to assign one."; return }
        await submit(path: "api/v1/scans", method: "POST", object: CreateManualRequest(displayID: display.id, expectedPogVersionID: pog.versionID))
    }
    public func save() async {
        guard let scan, canSave else { return }
        let items = reviewsEstimates ? reviewItems(scan) : scan.slots.map { CountRequest.Item(slotID: $0.id, quantity: Self.quantity(inputs[$0.id, default: ""])!) }
        await submit(path: "api/v1/scans/\(scan.scanID)/counts", method: "PATCH", object: CountRequest(expectedRevision: scan.revision, items: items))
    }
    public func confirm() async {
        guard let scan, canConfirm else { return }
        await submit(path: "api/v1/scans/\(scan.scanID)/confirm", method: "POST", object: RevisionRequest(expectedRevision: scan.revision))
    }
    public func complete() async {
        guard let scan, scan.status == "confirmed", !conflict else { return }
        await submit(path: "api/v1/scans/\(scan.scanID)/complete", method: "POST", object: RevisionRequest(expectedRevision: scan.revision))
    }
    public func retry() async { guard let pending else { return }; await perform(pending) }
    private func submit<T: Encodable>(path: String, method: String, object: T) async {
        guard !busy, pending == nil else { message = "Retry the pending request before making another change."; return }
        guard let data = try? JSONCoding.makeEncoder().encode(object) else { return }
        let request = (path, method, data, UUID().uuidString)
        pending = request
        await perform(request)
    }
    private func perform(_ request: (String, String, Data, String)) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await api.mutate(path: request.0, method: request.1, body: request.2, key: request.3)
            scan = result
            inputs = Dictionary(uniqueKeysWithValues: result.slots.map { ($0.id, $0.acceptedQuantity.map(String.init) ?? "") })
            checked = []
            pending = nil
            message = nil
            conflict = false
        } catch { report(error) }
    }
    private func report(_ error: any Error) {
        switch error as? APIClientError {
        case .signedOut: message = "Session expired. Sign in again."
        case .server(_, .conflict, _, _), .server(_, .pogChanged, _, _):
            conflict = true; pending = nil
            message = scan == nil ? "The display POG changed. Go back and refresh the display list before starting." : "The server revision changed. Reload latest; your entries will be retained for review."
        case .server(_, .forbidden, _, _), .server(_, .notFound, _, _):
            pending = nil; message = "Permission denied or scan unavailable. Contact your manager."
        case .server(_, .pogNotAssigned, _, _): pending = nil; message = "No published POG is assigned."
        case .server(let status, _, _, _) where status < 500 && status != 429:
            pending = nil; message = "The server rejected this request. Review the counts and reload if needed."
        default: message = "Can't reach the server. Your entries remain here. Retry the pending request. Network is required; entries are not synced offline."
        }
    }
}
