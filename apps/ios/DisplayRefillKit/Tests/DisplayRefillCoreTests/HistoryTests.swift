import Foundation
import Testing
@testable import DisplayRefillCore

private func item(_ id: String, status: String = "confirmed", total: Int? = 3, image: String = "none") -> String {
    """
    {"scan_id":"\(id)","organization_id":"o","store":{"store_id":"s1","name":"Synthetic Store","store_number":"1","timezone":"America/Toronto"},
     "display":{"display_id":"d1","name":"Case"},"pog":{"pog_version_id":"v1","version_number":1,"pog_name":"Layout","published_at":null},
     "status":"\(status)","source":"manual","created_at":"2026-10-03T12:00:00.123456Z","captured_at":null,"confirmed_at":null,"completed_at":null,
     "total_refill":\(total.map(String.init) ?? "null"),"display_score":null,"image_state":"\(image)","synthetic_analysis":false,"manual_takeover":false,
     "failure_code":null,"created_by_you":true}
    """
}
private func page(_ ids: [String], next: String?) throws -> ScanHistoryPage {
    let json = "{\"items\":[\(ids.map { item($0) }.joined(separator: ","))],\"next_cursor\":\(next.map { "\"\($0)\"" } ?? "null")}"
    return try JSONCoding.makeDecoder().decode(ScanHistoryPage.self, from: Data(json.utf8))
}
/// Shape produced by packages/server/src/scan-history.ts for a confirmed, completed photo check.
private func record(image: String = "retained") throws -> ScanRecord {
    let json = """
    {"scan":{"scan_id":"scan","display_id":"d1","pog_version_id":"v1","status":"completed","source":"photo","revision":6,"created_at":"2026-10-03T12:00:00Z",
      "image_available":\(image == "retained"),"provisional":false,"provisional_total_refill":null,"total_refill":3,"display_score":67,
      "confirmed_at":"2026-10-03T12:05:00Z","completed_by":"u1","completed_at":"2026-10-03T12:10:00Z",
      "analysis":{"generation":0,"failure_code":null,"retry_available":false,"retries_remaining":2,"alignment":"good","image_flags":[],"provider":"mock","synthetic":true,"manual_takeover_at":null},
      "unresolved_slot_ids":[],"products":[{"product_id":"p","refill_quantity":3}],
      "slots":[{"slot_id":"a1","product_id":"p","product_name":"Synthetic Fruit Cup","slot_label":"A1","target":5,"refill_threshold":2,"ai_quantity":3,"confidence":0.62,"flags":[],
        "accepted_quantity":3,"review_required":true,"review_state":"verified","final_quantity":3,"refill_quantity":0}]},
     "store":{"store_id":"s1","name":"Synthetic Store","store_number":"1","timezone":"UTC"},"display":{"display_id":"d1","name":"Case"},
     "pog":{"pog_version_id":"v1","version_number":1,"pog_name":"Layout","published_at":"2026-10-01T00:00:00Z"},
     "created_at":"2026-10-03T12:00:00Z","captured_at":"2026-10-03T12:00:30Z","created_by":{"user_id":"u1","is_you":true,"display_name":null},
     "manual_takeover":null,"image":{"state":"\(image)","deleted_at":\(image == "deleted" ? "\"2027-01-01T03:00:00Z\"" : "null")},
     "corrections":[{"correction_id":"c1","slot_id":"a1","slot_label":"A1","product_name":"Synthetic Fruit Cup","previous_quantity":3,"corrected_quantity":3,
       "original_ai_quantity":3,"reason":"visibility_check","verified":true,"scan_revision":4,"created_at":"2026-10-03T12:04:00Z","actor":{"user_id":"u1","is_you":true,"display_name":null}}],
     "confirmation":{"confirmed_at":"2026-10-03T12:05:00Z","confirmed_by":{"user_id":"u2","is_you":false,"display_name":"Synthetic Manager"},"scan_revision":5,"total_refill":3,"display_score":67},
     "completion":{"attested_at":"2026-10-03T12:10:00Z","attested_by":{"user_id":"u1","is_you":true,"display_name":null}},
     "analysis_attempts":null,"viewer":{"staff_names_visible":false,"analysis_metadata_visible":false}}
    """
    return try JSONCoding.makeDecoder().decode(ScanRecord.self, from: Data(json.utf8))
}

private actor HistoryFake: ScanHistoryAPI {
    var pages: [String: ScanHistoryPage] = [:]
    var failure: APIClientError?
    var imageFailure: APIClientError?
    var current: ScanRecord?
    var delays: [String: Duration] = [:]
    private(set) var calls: [(store: String?, cursor: String?, limit: Int)] = []
    private(set) var imageCalls = 0
    func set(_ key: String, _ page: ScanHistoryPage) { pages[key] = page }
    func fail(_ error: APIClientError?) { failure = error }
    func failImage(_ error: APIClientError?) { imageFailure = error }
    func setRecord(_ record: ScanRecord) { current = record }
    func delay(_ store: String, _ duration: Duration) { delays[store] = duration }
    func history(storeID: String?, cursor: String?, limit: Int) async throws -> ScanHistoryPage {
        calls.append((storeID, cursor, limit))
        if let delay = delays[storeID ?? "all"] { try await Task.sleep(for: delay) }
        if let failure { throw failure }
        return pages["\(storeID ?? "all")|\(cursor ?? "")"] ?? ScanHistoryPage(items: [], nextCursor: nil)
    }
    func record(id: String) async throws -> ScanRecord {
        if let failure { throw failure }
        return current!
    }
    func imageLink(id: String) async throws -> ImageLink {
        imageCalls += 1
        if let imageFailure { throw imageFailure }
        return ImageLink(url: URL(string: "https://storage.invalid/signed")!, expiresAt: Date())
    }
    func displays(store: String) async throws -> [ManualDisplay] { [] }
    func detail(id: String) async throws -> ScanDetail { current!.scan }
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail { current!.scan }
}

@Test @MainActor func historyPagesAppendInServerOrderAndStopAtTheLastPage() async throws {
    let api = HistoryFake()
    await api.set("all|", try page(["s3", "s2"], next: "c1"))
    await api.set("all|c1", try page(["s2", "s1"], next: nil))
    let model = HistoryList(api: api, pageSize: 2)
    await model.select(store: nil)
    #expect(model.phase == .loaded)
    #expect(model.items.map(\.id) == ["s3", "s2"])
    #expect(model.hasMore)
    await model.loadMore()
    // A row the server already sent is never shown twice.
    #expect(model.items.map(\.id) == ["s3", "s2", "s1"])
    #expect(!model.hasMore)
    await model.loadMore()
    let calls = await api.calls
    #expect(calls.map(\.cursor) == [nil, "c1"])
    #expect(calls.allSatisfy { $0.limit == 2 && $0.store == nil })
    #expect(model.items[0].totalRefill == 3)
    #expect(model.items[0].pog.label == "Layout · version 1")
}

@Test @MainActor func loadMoreFailureKeepsRowsAndCursorForRetry() async throws {
    let api = HistoryFake()
    await api.set("all|", try page(["s2"], next: "c1"))
    await api.set("all|c1", try page(["s1"], next: nil))
    let model = HistoryList(api: api)
    await model.reload()
    await api.fail(.transport(.notConnectedToInternet))
    await model.loadMore()
    #expect(model.items.map(\.id) == ["s2"])
    #expect(model.nextCursor == "c1")
    #expect(model.moreError?.contains("Can't reach the server") == true)
    #expect(model.phase == .loaded)
    await api.fail(nil)
    await model.loadMore()
    #expect(model.items.map(\.id) == ["s2", "s1"])
    #expect(model.moreError == nil)
}

@Test @MainActor func changingStoreDiscardsTheOlderSelectionsResponse() async throws {
    let api = HistoryFake()
    await api.set("slow|", try page(["slow-1"], next: nil))
    await api.set("fast|", try page(["fast-1"], next: nil))
    await api.delay("slow", .milliseconds(300))
    let model = HistoryList(api: api)
    let slow = Task { await model.select(store: "slow") }
    try await Task.sleep(for: .milliseconds(50))
    await model.select(store: "fast")
    await slow.value
    #expect(model.storeID == "fast")
    #expect(model.items.map(\.id) == ["fast-1"])
    #expect(model.phase == .loaded)
}

@Test @MainActor func historyFailuresAreExplainedWithoutShowingStaleRows() async throws {
    let api = HistoryFake()
    let model = HistoryList(api: api)
    await model.reload()
    #expect(model.isEmpty)
    await api.fail(.signedOut)
    await model.reload()
    #expect(model.phase == .signedOut)
    await api.fail(.server(status: 403, code: .forbidden, message: "", requestID: nil))
    await model.reload()
    #expect(model.phase == .failed("Your account no longer has access to these stores. Contact your administrator."))
    await api.fail(.server(status: 503, code: .dependencyUnavailable, message: "", requestID: nil))
    await model.reload()
    #expect(model.phase == .failed("History couldn't be loaded. Try again."))
    await api.fail(nil)
    await api.set("all|", try page(["s1"], next: nil))
    await model.reload()
    #expect(model.phase == .loaded && model.items.count == 1)
}

@Test @MainActor func recordKeepsEstimatesConfirmationAndAttestationSeparate() async throws {
    let api = HistoryFake()
    await api.setRecord(try record())
    let model = HistoryRecordModel(api: api, scanID: "scan")
    await model.load()
    let loaded = try #require(model.record)
    #expect(loaded.scan.slots[0].aiQuantity == 3)
    #expect(loaded.scan.slots[0].acceptedQuantity == 3)
    #expect(loaded.scan.slots[0].finalQuantity == 3)
    #expect(loaded.scan.analysis?.synthetic == true)
    #expect(loaded.confirmation?.totalRefill == 3)
    #expect(loaded.confirmation?.confirmedBy?.label == "Synthetic Manager")
    #expect(loaded.completion?.attestedBy?.label == "You")
    #expect(loaded.corrections.map(\.verified) == [true])
    #expect(loaded.pog.versionNumber == 1)
    #expect(model.photo == .notLoaded)
    await model.loadPhoto()
    #expect(model.photo == .shown(URL(string: "https://storage.invalid/signed")!))
    model.photoLinkFailed()
    #expect(model.photo == .failed("The photo link expired. Load it again."))
    await model.loadPhoto()
    #expect(await api.imageCalls == 2)
}

@Test @MainActor func deletedPhotoIsReportedWithoutRequestingALink() async throws {
    let api = HistoryFake()
    await api.setRecord(try record(image: "deleted"))
    let model = HistoryRecordModel(api: api, scanID: "scan")
    await model.load()
    #expect(model.photo == .removed("Photo removed under retention policy. Counts and review history remain."))
    #expect(model.record?.image.deletedAt != nil)
    #expect(model.record?.corrections.count == 1)
    #expect(await api.imageCalls == 0)

    // Retention ran after the record was read: the image route answers 410.
    await api.setRecord(try record())
    await model.load()
    await api.failImage(.server(status: 410, code: .imageDeleted, message: "", requestID: nil))
    await model.loadPhoto()
    #expect(model.photo == .removed(HistoryRecordModel.removedMessage))
    await api.failImage(.server(status: 404, code: .notFound, message: "", requestID: nil))
    await model.loadPhoto()
    #expect(model.photo == .failed("This photo isn't available to your account."))
}

@Test @MainActor func inaccessibleRecordShowsPermissionMessage() async throws {
    let api = HistoryFake()
    await api.fail(.server(status: 404, code: .notFound, message: "", requestID: nil))
    let model = HistoryRecordModel(api: api, scanID: "other-store")
    await model.load()
    #expect(model.record == nil)
    #expect(model.phase == .failed("This isn't available to your account. It may belong to a store you are not assigned to."))
}

@Test func historyRequestsUseBearerAuthAndEncodeFilters() async throws {
    let user = UUID()
    let initial = AuthSession(accessToken: "token", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600), userID: user, email: nil)
    let sessions = SessionManager(auth: HistoryAuth(session: initial), store: InMemorySessionStore(initial))
    let transport = StubTransport { request in
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token")
        #expect(request.httpMethod == "GET")
        if request.url?.path == "/api/v1/scans" {
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: true)?.queryItems ?? []
            #expect(query.first { $0.name == "store_id" }?.value == "s1")
            #expect(query.first { $0.name == "cursor" }?.value == "WyIyMDI2LTEwLTAzIl0_-")
            #expect(query.first { $0.name == "limit" }?.value == "25")
            return .success((200, "{\"data\":{\"items\":[],\"next_cursor\":null},\"request_id\":\"11111111-1111-4111-8111-111111111111\"}"))
        }
        #expect(request.url?.path == "/api/v1/scans/abc/image")
        return .success((410, "{\"error\":{\"code\":\"IMAGE_DELETED\",\"message\":\"Photo removed\",\"field_errors\":{}},\"request_id\":\"11111111-1111-4111-8111-111111111111\"}"))
    }
    let api = URLSessionAccountAPI(baseURL: URL(string: "http://localhost:3100")!, sessions: sessions, transport: transport)
    let empty = try await api.history(storeID: "s1", cursor: "WyIyMDI2LTEwLTAzIl0_-", limit: 25)
    #expect(empty.items.isEmpty)
    await #expect(throws: APIClientError.server(status: 410, code: .imageDeleted, message: "Photo removed", requestID: UUID(uuidString: "11111111-1111-4111-8111-111111111111"))) {
        _ = try await api.imageLink(id: "abc")
    }
}

private struct HistoryAuth: SupabaseAuthAPI {
    let session: AuthSession
    func signIn(email: String, password: String) async throws(AuthError) -> AuthSession { session }
    func refresh(refreshToken: String) async throws(AuthError) -> AuthSession { session }
    func signOut(accessToken: String) async throws(AuthError) {}
}
