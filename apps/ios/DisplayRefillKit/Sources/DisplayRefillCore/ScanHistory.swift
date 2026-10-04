import Foundation
import Observation

/// One row of `GET /api/v1/scans` (Feature 11). The server returns only scans
/// in stores this account may read; refill totals appear only once confirmed.
public struct ScanHistoryItem: Decodable, Sendable, Identifiable, Equatable {
    public struct Store: Decodable, Sendable, Equatable {
        public let storeID: String
        public let name: String?
        public let storeNumber: String?
        public let timezone: String
        enum CodingKeys: String, CodingKey { case name, timezone, storeID = "store_id", storeNumber = "store_number" }
    }
    public struct Display: Decodable, Sendable, Equatable {
        public let displayID: String
        public let name: String?
        enum CodingKeys: String, CodingKey { case name, displayID = "display_id" }
    }
    /// The layout version pinned when the scan started; never the display's current one.
    public struct Pog: Decodable, Sendable, Equatable {
        public let pogVersionID: String
        public let versionNumber: Int?
        public let pogName: String?
        public let publishedAt: Date?
        enum CodingKeys: String, CodingKey {
            case pogVersionID = "pog_version_id", versionNumber = "version_number", pogName = "pog_name", publishedAt = "published_at"
        }
        public var label: String { "\(pogName ?? "Layout") · version \(versionNumber.map(String.init) ?? "unknown")" }
    }
    public var id: String { scanID }
    public let scanID: String
    public let store: Store
    public let display: Display
    public let pog: Pog
    public let status: String
    public let source: String
    public let createdAt: Date
    public let confirmedAt: Date?
    /// When an employee attested the refill was done. Not a stock reading.
    public let completedAt: Date?
    /// Confirmed total only; nil while counts are unconfirmed.
    public let totalRefill: Int?
    /// "none", "retained" or "deleted" (removed under retention; metadata kept).
    public let imageState: String
    /// Estimates came from the deterministic mock provider, not the photo.
    public let syntheticAnalysis: Bool
    public let manualTakeover: Bool
    public let createdByYou: Bool
    enum CodingKeys: String, CodingKey {
        case store, display, pog, status, source
        case scanID = "scan_id", createdAt = "created_at", confirmedAt = "confirmed_at", completedAt = "completed_at"
        case totalRefill = "total_refill", imageState = "image_state", syntheticAnalysis = "synthetic_analysis"
        case manualTakeover = "manual_takeover", createdByYou = "created_by_you"
    }
}

public struct ScanHistoryPage: Decodable, Sendable {
    public let items: [ScanHistoryItem]
    public let nextCursor: String?
    enum CodingKeys: String, CodingKey { case items, nextCursor = "next_cursor" }
}

/// `GET /api/v1/scans/:id/history`: the review record. `scan` is the same
/// detail as `GET /scans/:id`; estimates, corrections, the confirmation and the
/// completion attestation are separate fields so they are never conflated.
public struct ScanRecord: Decodable, Sendable {
    public struct Actor: Decodable, Sendable, Equatable {
        public let userID: String
        public let isYou: Bool
        /// Only for store managers and organization admins.
        public let displayName: String?
        enum CodingKeys: String, CodingKey { case userID = "user_id", isYou = "is_you", displayName = "display_name" }
        public var label: String { isYou ? "You" : displayName ?? "Another team member" }
    }
    public struct Correction: Decodable, Sendable, Identifiable, Equatable {
        public var id: String { correctionID }
        public let correctionID: String
        public let slotLabel: String?
        public let productName: String?
        public let previousQuantity: Int?
        public let correctedQuantity: Int
        public let originalAIQuantity: Int?
        public let reason: String?
        /// nil for rows saved before review tracking (Feature 10).
        public let verified: Bool?
        public let scanRevision: Int
        public let createdAt: Date
        public let actor: Actor?
        enum CodingKeys: String, CodingKey {
            case reason, verified, actor
            case correctionID = "correction_id", slotLabel = "slot_label", productName = "product_name"
            case previousQuantity = "previous_quantity", correctedQuantity = "corrected_quantity"
            case originalAIQuantity = "original_ai_quantity", scanRevision = "scan_revision", createdAt = "created_at"
        }
    }
    public struct Confirmation: Decodable, Sendable, Equatable {
        public let confirmedAt: Date
        public let confirmedBy: Actor?
        public let scanRevision: Int
        public let totalRefill: Int
        public let displayScore: Int?
        enum CodingKeys: String, CodingKey {
            case confirmedAt = "confirmed_at", confirmedBy = "confirmed_by", scanRevision = "scan_revision"
            case totalRefill = "total_refill", displayScore = "display_score"
        }
    }
    /// The employee's statement that the refill was done.
    public struct Completion: Decodable, Sendable, Equatable {
        public let attestedAt: Date
        public let attestedBy: Actor?
        enum CodingKeys: String, CodingKey { case attestedAt = "attested_at", attestedBy = "attested_by" }
    }
    public struct Image: Decodable, Sendable, Equatable {
        public let state: String
        public let deletedAt: Date?
        enum CodingKeys: String, CodingKey { case state, deletedAt = "deleted_at" }
    }
    public struct Takeover: Decodable, Sendable, Equatable {
        public let at: Date
        public let by: Actor?
    }
    public let scan: ScanDetail
    public let store: ScanHistoryItem.Store
    public let display: ScanHistoryItem.Display
    public let pog: ScanHistoryItem.Pog
    public let createdAt: Date
    public let capturedAt: Date?
    public let createdBy: Actor?
    public let image: Image
    public let corrections: [Correction]
    public let confirmation: Confirmation?
    public let completion: Completion?
    public let manualTakeover: Takeover?
    enum CodingKeys: String, CodingKey {
        case scan, store, display, pog, image, corrections, confirmation, completion
        case createdAt = "created_at", capturedAt = "captured_at", createdBy = "created_by", manualTakeover = "manual_takeover"
    }
}

/// `GET /api/v1/scans/:id/image`: a five-minute private link, held in memory only.
public struct ImageLink: Decodable, Sendable, Equatable {
    public let url: URL
    public let expiresAt: Date
    enum CodingKeys: String, CodingKey { case url, expiresAt = "expires_at" }
}

public protocol ScanHistoryAPI: ManualScanAPI {
    func history(storeID: String?, cursor: String?, limit: Int) async throws -> ScanHistoryPage
    func record(id: String) async throws -> ScanRecord
    func imageLink(id: String) async throws -> ImageLink
}

extension URLSessionAccountAPI: ScanHistoryAPI {
    public func history(storeID: String?, cursor: String?, limit: Int) async throws -> ScanHistoryPage {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
            + (storeID.map { [URLQueryItem(name: "store_id", value: $0)] } ?? [])
            + (cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
        return try await authorizedRequest("api/v1/scans?\(query.percentEncodedQuery ?? "")")
    }
    public func record(id: String) async throws -> ScanRecord { try await authorizedRequest("api/v1/scans/\(id)/history") }
    public func imageLink(id: String) async throws -> ImageLink { try await authorizedRequest("api/v1/scans/\(id)/image") }
}

/// Plain-language scan states shared by history rows and records.
public enum ScanStatusText {
    public static func label(_ status: String) -> String {
        switch status {
        case "awaiting_upload": "Waiting for photo"
        case "queued": "Queued for analysis"
        case "processing": "Analysing photo"
        case "needs_review": "Needs review"
        case "failed": "Analysis failed"
        case "confirmed": "Confirmed"
        case "completed": "Refill marked done"
        default: status
        }
    }
    public static func source(_ source: String, takenOver: Bool) -> String {
        source == "photo" ? "Photo" : takenOver ? "Manual (photo analysis taken over)" : "Manual"
    }
    /// Store-local timestamp with the zone's abbreviation.
    public static func time(_ date: Date, timeZone identifier: String) -> String {
        let zone = TimeZone(identifier: identifier) ?? .gmt
        var style = Date.FormatStyle(date: .abbreviated, time: .shortened)
        style.timeZone = zone
        return "\(date.formatted(style)) \(zone.abbreviation(for: date) ?? identifier)"
    }
}

public enum HistoryFailure {
    /// User-facing text for a failed history read; `nil` only for success.
    public static func message(_ error: any Error) -> String {
        switch error as? APIClientError {
        case .signedOut: "Session expired. Sign in again."
        case .server(_, .forbidden, _, _): "Your account no longer has access to these stores. Contact your administrator."
        case .server(_, .notFound, _, _): "This isn't available to your account. It may belong to a store you are not assigned to."
        case .transport: "Can't reach the server. Check your connection and try again."
        default: "History couldn't be loaded. Try again."
        }
    }
    public static func isSignedOut(_ error: any Error) -> Bool { (error as? APIClientError) == .signedOut }
}

/// Newest-first history pages for one store or every assigned store. The
/// server's (created_at, id) cursor keeps pages stable; a response for an
/// older store selection or reload is discarded.
@MainActor @Observable
public final class HistoryList {
    public enum Phase: Equatable, Sendable { case idle, loading, loaded, failed(String), signedOut }
    public private(set) var phase: Phase = .idle
    public private(set) var items: [ScanHistoryItem] = []
    public private(set) var nextCursor: String?
    public private(set) var loadingMore = false
    public private(set) var moreError: String?
    public private(set) var storeID: String?
    public let pageSize: Int
    private let api: any ScanHistoryAPI
    private var generation = 0

    public init(api: any ScanHistoryAPI, pageSize: Int = 25) {
        self.api = api
        self.pageSize = pageSize
    }
    public var isEmpty: Bool { phase == .loaded && items.isEmpty }
    public var hasMore: Bool { nextCursor != nil }

    public func select(store: String?) async {
        guard store != storeID || phase == .idle else { return }
        storeID = store
        items = []
        nextCursor = nil
        await reload()
    }
    /// First page again; current rows stay visible until the new page arrives.
    public func reload() async {
        generation += 1
        let current = generation
        phase = .loading
        moreError = nil
        do {
            let page = try await api.history(storeID: storeID, cursor: nil, limit: pageSize)
            guard current == generation else { return }
            items = page.items
            nextCursor = page.nextCursor
            phase = .loaded
        } catch {
            guard current == generation else { return }
            phase = HistoryFailure.isSignedOut(error) ? .signedOut : .failed(HistoryFailure.message(error))
        }
    }
    /// Next page. A failure keeps every loaded row and the cursor for retry.
    public func loadMore() async {
        guard phase == .loaded, let cursor = nextCursor, !loadingMore else { return }
        let current = generation
        loadingMore = true
        moreError = nil
        do {
            let page = try await api.history(storeID: storeID, cursor: cursor, limit: pageSize)
            guard current == generation else { return }
            let seen = Set(items.map(\.id))
            items += page.items.filter { !seen.contains($0.id) }
            nextCursor = page.nextCursor
        } catch {
            if current == generation {
                if HistoryFailure.isSignedOut(error) { phase = .signedOut } else { moreError = "Couldn't load more checks. \(HistoryFailure.message(error))" }
            }
        }
        if current == generation { loadingMore = false }
    }
}

/// One review record plus its photo state. Removed photos are reported from
/// the record without requesting a link; a link is requested only for a
/// retained photo and can be renewed after it expires.
@MainActor @Observable
public final class HistoryRecordModel {
    public enum Phase: Equatable, Sendable { case loading, loaded, failed(String), signedOut }
    public enum Photo: Equatable, Sendable { case none, removed(String), notLoaded, loading, shown(URL), failed(String) }
    public static let removedMessage = "Photo removed under retention policy. Counts and review history remain."
    public private(set) var phase: Phase = .loading
    public private(set) var record: ScanRecord?
    public private(set) var photo: Photo = .none
    private let api: any ScanHistoryAPI
    public let scanID: String

    public init(api: any ScanHistoryAPI, scanID: String) {
        self.api = api
        self.scanID = scanID
    }
    public func load() async {
        phase = .loading
        do {
            let loaded = try await api.record(id: scanID)
            record = loaded
            photo = switch loaded.image.state {
            case "retained": .notLoaded
            case "deleted": .removed(Self.removedMessage)
            default: .none
            }
            phase = .loaded
        } catch {
            phase = HistoryFailure.isSignedOut(error) ? .signedOut : .failed(HistoryFailure.message(error))
        }
    }
    public func loadPhoto() async {
        guard record != nil, photo != .loading else { return }
        photo = .loading
        do {
            photo = .shown(try await api.imageLink(id: scanID).url)
        } catch {
            switch error as? APIClientError {
            case .server(_, .imageDeleted, _, _), .server(410, _, _, _): photo = .removed(Self.removedMessage)
            case .signedOut: photo = .failed("Session expired. Sign in again.")
            case .server(_, .notFound, _, _), .server(_, .forbidden, _, _): photo = .failed("This photo isn't available to your account.")
            default: photo = .failed("The photo couldn't be loaded. Check your connection and try again.")
            }
        }
    }
    /// The image request failed after a link was issued (usually an expired link).
    public func photoLinkFailed() { photo = .failed("The photo link expired. Load it again.") }
}
