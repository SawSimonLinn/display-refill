import Foundation
import Observation

public struct PhotoCrop: Codable, Sendable, Equatable {
    public var x: Double = 0
    public var y: Double = 0
    public var width: Double = 1
    public var height: Double = 1
    public init() {}
    public var valid: Bool { x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001 }
}
public struct PhotoResponse: Decodable, Sendable {
    public let scan: ScanDetail
    public let upload: Upload
    public struct Upload: Decodable, Sendable {
        public let expiresAt: Date
        enum CodingKeys: String, CodingKey { case expiresAt = "expires_at" }
    }
}
public struct ReferenceAccess: Decodable, Sendable {
    public let url: URL
    public let width: Int
    public let height: Int
}
public protocol PhotoScanAPI: Sendable {
    func photoRequest(path: String, body: Data, key: String) async throws -> PhotoResponse
    func uploadPhoto(id: String, jpeg: Data) async throws
    func reference(version: String) async throws -> ReferenceAccess
    /// Authorized scan detail, used to poll analysis state.
    func detail(id: String) async throws -> ScanDetail
    /// Revision-checked scan action (explicit analysis retry).
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail
}

/// What the photo screen shows after the photo is stored. Never a fabricated
/// percentage: only the server's state, an elapsed-time delay notice and
/// counts derived from the server's slot observations.
public enum AnalysisState: Equatable, Sendable {
    case notSubmitted
    /// queued or processing; `delayed` after 30 seconds.
    case waiting(processing: Bool, delayed: Bool)
    case reviewReady(ReviewSummary)
    case failed(code: String?, retryAvailable: Bool)
    /// Manual takeover or any later state; analysis no longer applies.
    case manual(status: String)
    /// Polling could not reach the server; it keeps retrying while visible.
    case unreachable(delayed: Bool)
}

public struct ReviewSummary: Equatable, Sendable {
    public let total: Int
    public let estimated: Int
    public let unknown: Int
    public let needsVerification: Int
    public let alignmentUnclear: Bool
    public let imageFlags: [String]
    public let synthetic: Bool
    public init(scan: ScanDetail) {
        total = scan.slots.count
        estimated = scan.slots.filter { $0.aiQuantity != nil }.count
        unknown = total - estimated
        needsVerification = scan.slots.filter { $0.reviewRequired ?? true }.count
        alignmentUnclear = scan.analysis.map { $0.alignment != nil && $0.alignment != "good" } ?? false
        imageFlags = scan.analysis?.imageFlags ?? []
        synthetic = scan.analysis?.synthetic ?? false
    }
}

/// Poll schedule from scan-lifecycle.md: every 2 seconds initially, backing off to 5.
public enum AnalysisPolling {
    public static let delayNotice: TimeInterval = 30
    public static func interval(afterPoll index: Int) -> Duration {
        .seconds(min(5, index < 5 ? 2 : index - 2))
    }
}
extension URLSessionAccountAPI: PhotoScanAPI {
    public func photoRequest(path: String, body: Data, key: String) async throws -> PhotoResponse {
        try await authorizedRequest(path, method: "POST", body: body, key: key)
    }
    public func uploadPhoto(id: String, jpeg: Data) async throws {
        struct Ack: Decodable, Sendable { let uploaded: Bool }
        let _: Ack = try await authorizedRequest("api/v1/scans/\(id)/image", method: "PUT", body: jpeg, contentType: "image/jpeg")
    }
    public func reference(version: String) async throws -> ReferenceAccess {
        try await authorizedRequest("api/v1/pog-versions/\(version)/image-access")
    }
}
/// Account/display-scoped pending bytes and keys survive backgrounding and process death.
/// Cache eviction can remove recovery data; this is not an offline synchronization promise.
@MainActor @Observable public final class PhotoWorkflow {
    public private(set) var jpeg: Data?
    public var crop = PhotoCrop()
    public private(set) var scanID: String?
    public private(set) var finished = false
    public private(set) var busy = false
    public private(set) var message: String?
    public private(set) var locked = false
    public var reference: ReferenceAccess?
    public private(set) var analysis: AnalysisState = .notSubmitted
    private var revision: Int?
    private let api: any PhotoScanAPI
    private let display: ManualDisplay
    private let file: URL
    private var pending: Pending?
    private struct Pending: Codable {
        var jpeg: Data
        var crop: PhotoCrop
        var createBody: Data
        var createKey: String
        var finalizeKey: String
        var scanID: String?
        var revision: Int?
        var finalizeBody: Data?
        var finished: Bool = false
        var finalizedAt: Date?
        /// Exact retry request, kept until the server answers so a lost response replays safely.
        var retryBody: Data?
        var retryKey: String?
    }
    public init(api: any PhotoScanAPI, display: ManualDisplay, userID: String, directory: URL? = nil) {
        self.api = api; self.display = display
        let root = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "DisplayRefill")
        file = root.appending(path: "\(userID)-\(display.id).json")
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(Pending.self, from: data) {
            pending = saved; jpeg = saved.jpeg; crop = saved.crop; scanID = saved.scanID; finished = saved.finished; locked = true
            if saved.finished { analysis = .waiting(processing: false, delayed: false) }
            message = saved.finished ? "Photo stored privately. Checking analysis status." : "Interrupted photo submission restored. Retry uses the same photo and request keys."
        }
    }
    public func setPhoto(_ data: Data) {
        guard !busy else { return }
        pending = nil; try? FileManager.default.removeItem(at: file)
        jpeg = data; crop = PhotoCrop(); scanID = nil; locked = false; finished = false; message = nil
        analysis = .notSubmitted; revision = nil
    }
    public func notice(_ text: String) { message = text }
    public func loadReference() async {
        guard let pog = display.activePog else { return }
        do { reference = try await api.reference(version: pog.versionID) }
        catch { message = "Reference unavailable. Check your connection before framing, or use a manual check." }
    }
    public func submit() async {
        guard !busy, !finished, let jpeg, crop.valid, let pog = display.activePog else { return }
        busy = true; defer { busy = false }
        do {
            if pending == nil {
                let body = try JSONSerialization.data(withJSONObject: ["display_id": display.id, "source": "photo", "expected_pog_version_id": pog.versionID], options: .sortedKeys)
                pending = Pending(jpeg: jpeg, crop: crop, createBody: body, createKey: UUID().uuidString, finalizeKey: UUID().uuidString)
                locked = true; try persist()
            }
            guard var request = pending else { return }
            if request.scanID == nil {
                let created = try await api.photoRequest(path: "api/v1/scans", body: request.createBody, key: request.createKey)
                request.scanID = created.scan.scanID; request.revision = created.scan.revision
                pending = request; scanID = request.scanID; try persist()
            }
            let id = request.scanID!
            if request.finalizeBody == nil {
                request.finalizeBody = try JSONSerialization.data(withJSONObject: ["expected_revision": request.revision!, "crop": ["x": request.crop.x, "y": request.crop.y, "width": request.crop.width, "height": request.crop.height]], options: .sortedKeys)
                pending = request; try persist()
            }
            // First retry finalization: it may already have committed before a lost response.
            do {
                _ = try await api.photoRequest(path: "api/v1/scans/\(id)/finalize-upload", body: request.finalizeBody!, key: request.finalizeKey)
            } catch {
                switch error as? APIClientError {
                case .server(let status, _, _, _) where status == 409 || status == 503:
                    let empty = Data("{}".utf8)
                    _ = try await api.photoRequest(path: "api/v1/scans/\(id)/renew-upload", body: empty, key: request.createKey)
                    try await api.uploadPhoto(id: id, jpeg: request.jpeg)
                    _ = try await api.photoRequest(path: "api/v1/scans/\(id)/finalize-upload", body: request.finalizeBody!, key: request.finalizeKey)
                default: throw error
                }
            }
            request.finished = true; request.finalizedAt = Date(); pending = request; finished = true; try persist()
            analysis = .waiting(processing: false, delayed: false)
            message = "Photo stored privately and queued for analysis."
        } catch {
            switch error as? APIClientError {
            case .signedOut: message = "Session expired. Sign in again; then reopen this display."
            case .server(_, .forbidden, _, _), .server(_, .notFound, _, _): message = "Access denied or scan unavailable. Ask your manager; manual mode remains available."
            case .server(_, .pogChanged, _, _): message = "The assigned POG changed. Go back, refresh displays and retake."
            case .server(let status, _, let text, _) where status < 500 && status != 429: message = "\(text) Retry or retake with a new scan."
            default: message = "Connection interrupted. The photo and request keys are saved on this device. Retry when connected."
            }
        }
    }
    /// Polls until the scan leaves queued/processing or the task is cancelled
    /// (backgrounding, leaving the screen). A client disconnect never cancels
    /// the server's durable job; reopening resumes from the scan ID.
    public func pollAnalysis(sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }, now: @Sendable () -> Date = Date.init) async {
        guard finished, let id = scanID ?? pending?.scanID else { return }
        let started = pending?.finalizedAt ?? now()
        var index = 0
        while !Task.isCancelled {
            let delayed = now().timeIntervalSince(started) >= AnalysisPolling.delayNotice
            do {
                let scan = try await api.detail(id: id)
                apply(scan, delayed: now().timeIntervalSince(started) >= AnalysisPolling.delayNotice)
                if case .waiting = analysis {} else { return }
            } catch {
                switch error as? APIClientError {
                case .signedOut: message = "Session expired. Sign in again; then reopen this display."; return
                case .server(_, .forbidden, _, _), .server(_, .notFound, _, _): message = "Access denied or scan unavailable. Ask your manager; manual mode remains available."; return
                default: analysis = .unreachable(delayed: delayed)
                }
            }
            do { try await sleep(AnalysisPolling.interval(afterPoll: index)) } catch { return }
            index += 1
        }
    }

    /// Explicit retry of a failed analysis. The server enforces the retry limit.
    public func retryAnalysis() async {
        guard !busy, case .failed(_, true) = analysis, let id = scanID, var request = pending else { return }
        busy = true; defer { busy = false }
        do {
            if request.retryBody == nil, let revision {
                request.retryBody = try JSONSerialization.data(withJSONObject: ["expected_revision": revision], options: .sortedKeys)
                request.retryKey = UUID().uuidString; pending = request; try persist()
            }
            guard let body = request.retryBody, let key = request.retryKey else { return }
            let scan = try await api.mutate(path: "api/v1/scans/\(id)/retry", method: "POST", body: body, key: key)
            request.retryBody = nil; request.retryKey = nil; request.finalizedAt = Date(); pending = request; try persist()
            apply(scan, delayed: false)
            message = "Analysis restarted."
        } catch {
            switch error as? APIClientError {
            case .signedOut: message = "Session expired. Sign in again; then reopen this display."
            case .server(_, .conflict, _, _):
                // Revision or retry limit changed elsewhere: drop the stale request and reload.
                request.retryBody = nil; request.retryKey = nil; pending = request; try? persist()
                message = "This scan changed or has no retries left. Reloading its status."
                if let scan = try? await api.detail(id: id) { apply(scan, delayed: false) }
            case .server(_, .forbidden, _, _), .server(_, .notFound, _, _): message = "Access denied or scan unavailable. Manual mode remains available."
            default: message = "Can't reach the server. Retry when connected; the same request will be sent."
            }
        }
    }

    private func apply(_ scan: ScanDetail, delayed: Bool) {
        revision = scan.revision
        switch scan.status {
        case "awaiting_upload", "queued": analysis = .waiting(processing: false, delayed: delayed)
        case "processing": analysis = .waiting(processing: true, delayed: delayed)
        case "failed": analysis = .failed(code: scan.analysis?.failureCode, retryAvailable: scan.analysis?.retryAvailable ?? false)
        case "needs_review" where scan.source == "photo" && scan.analysis?.alignment != nil: analysis = .reviewReady(ReviewSummary(scan: scan))
        default: analysis = .manual(status: scan.status)
        }
    }

    private func persist() throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(pending).write(to: file, options: [.atomic, .completeFileProtectionUnlessOpen])
    }
}
