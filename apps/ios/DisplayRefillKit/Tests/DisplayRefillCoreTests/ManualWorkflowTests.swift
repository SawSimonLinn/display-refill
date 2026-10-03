import Foundation
import Testing
@testable import DisplayRefillCore

private func fixture(revision: Int = 1, quantity: Int? = nil, status: String = "needs_review", refill: Int = 73) throws -> ScanDetail {
    let q = quantity.map(String.init) ?? "null"
    let unresolved = quantity == nil ? "[\"slot\"]" : "[]"
    let json = """
    {"scan_id":"scan","status":"\(status)","revision":\(revision),"created_at":"2026-10-03T12:00:00Z",
    "completed_at":null,"completed_by":null,"unresolved_slot_ids":\(unresolved),
    "provisional_total_refill":\(refill),"total_refill":null,
    "products":[{"product_id":"product","refill_quantity":\(refill)}],
    "slots":[{"slot_id":"slot","product_id":"product","product_name":"Synthetic","slot_label":"A","target":3,
    "refill_threshold":null,"accepted_quantity":\(q),"review_state":"\(quantity == nil ? "pending" : "verified")","refill_quantity":\(refill)}]}
    """
    return try JSONCoding.makeDecoder().decode(ScanDetail.self, from: Data(json.utf8))
}
private actor ManualFake: ManualScanAPI {
    var current: ScanDetail
    var failure: APIClientError?
    var calls: [(Data, String)] = []
    init(_ scan: ScanDetail) { current = scan }
    func set(_ scan: ScanDetail) { current = scan }
    func fail(_ error: APIClientError?) { failure = error }
    func displays(store: String) async throws -> [ManualDisplay] { [] }
    func detail(id: String) async throws -> ScanDetail { current }
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail {
        calls.append((body, key))
        if let failure { throw failure }
        return current
    }
    func requests() -> [(Data, String)] { calls }
}
@Test @MainActor func unknownZeroAndServerRecommendations() async throws {
    let api = ManualFake(try fixture())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    #expect(model.inputs["slot"] == "")
    #expect(!model.valid)
    await model.confirm()
    #expect(await api.requests().isEmpty)
    model.inputs["slot"] = "0"
    #expect(model.valid && model.dirty)
    await api.set(try fixture(revision: 2, quantity: 0))
    await model.save()
    #expect(model.scan?.products.first?.refillQuantity == 73) // deliberately not client arithmetic
    #expect(!model.dirty)
    let requests = await api.requests()
    let object = try #require(JSONSerialization.jsonObject(with: requests[0].0) as? [String: Any])
    let items = try #require(object["items"] as? [[String: Any]])
    #expect(items[0]["quantity"] as? Int == 0)
    #expect(items[0]["reason"] as? String == "manual_count")
    #expect(items[0]["verified"] as? Bool == true)
}
@Test @MainActor func transientRetryKeepsExactBytesAndKey() async throws {
    let api = ManualFake(try fixture())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    model.inputs["slot"] = "2"
    await api.fail(.transport(.notConnectedToInternet))
    await model.save()
    #expect(model.inputs["slot"] == "2")
    #expect(model.hasPendingRequest)
    await api.fail(nil)
    await api.set(try fixture(revision: 2, quantity: 2))
    await model.retry()
    let calls = await api.requests()
    #expect(calls.count == 2)
    #expect(calls[0].0 == calls[1].0 && calls[0].1 == calls[1].1)
    #expect(!model.hasPendingRequest)
}
@Test @MainActor func conflictRecoveryPreservesEditsAndUsesLatestRevision() async throws {
    let api = ManualFake(try fixture())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    model.inputs["slot"] = "2"
    await api.fail(.server(status: 409, code: .conflict, message: "", requestID: nil))
    await model.save()
    #expect(model.conflict && model.inputs["slot"] == "2")
    await api.set(try fixture(revision: 4, quantity: 1))
    await model.load(id: "scan", preserve: true)
    #expect(model.inputs["slot"] == "2")
    #expect(model.scan?.revision == 4 && model.dirty)
    await api.fail(nil)
    await api.set(try fixture(revision: 5, quantity: 2))
    await model.save()
    let calls = await api.requests()
    let object = try #require(JSONSerialization.jsonObject(with: calls[1].0) as? [String: Any])
    #expect(object["expected_revision"] as? Int == 4)
    #expect(calls[0].1 != calls[1].1)
}
@Test @MainActor func frozenScanCannotSubmitCountsAndReopensInNewModel() async throws {
    let api = ManualFake(try fixture(revision: 3, quantity: 0, status: "confirmed"))
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    model.inputs["slot"] = "99"
    await model.save()
    #expect(await api.requests().isEmpty)
    let restarted = ManualWorkflow(api: api)
    await restarted.load(id: "scan")
    #expect(restarted.inputs["slot"] == "0")
    #expect(restarted.scan?.status == "confirmed")
}
@Test func numericCountsAreStrict() {
    for text in ["", "-1", "1.2", "1000", "zero", "１", " 0"] { #expect(ManualWorkflow.quantity(text) == nil) }
    #expect(ManualWorkflow.quantity("0") == 0)
    #expect(ManualWorkflow.quantity("999") == 999)
}

private struct ManualRefreshAuth: SupabaseAuthAPI {
    let refreshed: AuthSession
    func signIn(email: String, password: String) async throws(AuthError) -> AuthSession { refreshed }
    func refresh(refreshToken: String) async throws(AuthError) -> AuthSession { refreshed }
    func signOut(accessToken: String) async throws(AuthError) {}
}
@Test func mutationUnauthorizedRefreshRetainsBodyAndIdempotencyKey() async throws {
    let user = UUID()
    let initial = AuthSession(accessToken: "old", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(3600), userID: user, email: nil)
    let refreshed = AuthSession(accessToken: "new", refreshToken: "next", expiresAt: Date().addingTimeInterval(3600), userID: user, email: nil)
    let auth = ManualRefreshAuth(refreshed: refreshed)
    let sessions = SessionManager(auth: auth, store: InMemorySessionStore(initial))
    let response = """
    {"data":{"scan_id":"scan","status":"needs_review","revision":2,"created_at":"2026-10-03T12:00:00Z",
    "slots":[],"products":[],"unresolved_slot_ids":[]},"request_id":"11111111-1111-4111-8111-111111111111"}
    """
    let transport = StubTransport { request in
        #expect(request.url?.path == "/api/v1/scans/scan/counts")
        #expect(request.httpMethod == "PATCH")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "retry-key")
        #expect(request.httpBody == Data("{\"expected_revision\":1}".utf8))
        if request.value(forHTTPHeaderField: "Authorization") == "Bearer old" {
            return .success((401, "{}"))
        }
        return .success((200, response))
    }
    let api = URLSessionAccountAPI(baseURL: URL(string: "http://localhost:3100")!, sessions: sessions, transport: transport)
    _ = try await api.mutate(path: "api/v1/scans/scan/counts", method: "PATCH", body: Data("{\"expected_revision\":1}".utf8), key: "retry-key")
    #expect(transport.count("counts") == 2)
    #expect(await sessions.refreshCount == 1)
}
@Test @MainActor func deniedRequestRetainsInputAndAllowsAccessRetry() async throws {
    let api = ManualFake(try fixture())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    model.inputs["slot"] = "0"
    await api.fail(.server(status: 403, code: .forbidden, message: "", requestID: nil))
    await model.save()
    #expect(model.inputs["slot"] == "0")
    #expect(!model.hasPendingRequest)
    #expect(model.message?.contains("Permission denied") == true)
}
