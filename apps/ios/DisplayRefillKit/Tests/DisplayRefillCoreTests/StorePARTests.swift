import Foundation
import Testing
@testable import DisplayRefillCore

// Store PAR on mobile: managers override a display case type's default PAR for their store.

private let supabaseURL = URL(string: "http://127.0.0.1:54321")!
private let apiURL = URL(string: "http://localhost:3000")!
private let envelope = #""request_id":"0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10""#

private func signedIn(_ handler: @escaping StubTransport.Handler) -> (StubTransport, URLSessionAccountAPI) {
    let transport = StubTransport(handler)
    let saved = AuthSession(accessToken: "a1", refreshToken: "r1", expiresAt: Date().addingTimeInterval(3600), userID: UUID(), email: "e@example.com")
    let sessions = SessionManager(auth: SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "k", transport: transport), store: InMemorySessionStore(saved))
    return (transport, URLSessionAccountAPI(baseURL: apiURL, sessions: sessions, transport: transport))
}

private func config(par: Int, overridden: Bool, revision: Int = 3, other: Int = 6) -> String {
    #"{"data":{"can_manage":true,"sections":[{"id":"t1","code":"fruit_4ft","name":"4ft Fruit","family":"Fruit","selected":true},{"id":"t2","code":"veg_combo_2_shelf","name":"2 Shelf Veg Combo","family":"Vegetables","selected":true}],"items":[{"id":"i1","product_id":"p1","product_name":"PINEAPPLE CUP","section":"fruit_4ft","category":"Shelf 5","product_type":"Sellable package","sort_order":9,"active":true,"revision":\#(revision),"updated_at":"2026-10-08T10:00:00Z","updated_by":null,"par":\#(par),"from_display_type":true,"par_overridden":\#(overridden),"default_par":3},{"id":"i2","product_id":"p2","product_name":"GUAC MILD","section":"veg_combo_2_shelf","category":"Shelf 6","product_type":"Sellable package","sort_order":2,"active":true,"revision":1,"updated_at":"2026-10-08T10:00:00Z","updated_by":null,"par":\#(other),"from_display_type":true,"par_overridden":false,"default_par":6},{"id":"i3","product_id":"p3","product_name":"OLD ITEM","section":"fruit_4ft","category":"","product_type":"","sort_order":1,"active":false,"revision":1,"updated_at":"2026-10-08T10:00:00Z","updated_by":null,"par":2,"from_display_type":false,"par_overridden":false,"default_par":null}]},\#(envelope)}"#
}

private func body(_ request: URLRequest) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]) ?? [:]
}

@Suite struct StorePARTests {
    @Test func groupsActiveItemsInTypeOrder() async throws {
        let (_, api) = signedIn { _ in .success((200, config(par: 3, overridden: false))) }
        let loaded = try await api.storePAR(storeID: "s1")
        #expect(loaded.groups.map(\.name) == ["4ft Fruit", "2 Shelf Veg Combo"])
        #expect(loaded.groups[0].items.map(\.id) == ["i1"])
        #expect(loaded.items[0].canReset == false)
    }

    @Test func saveSendsOnlyANewParWithEveryOtherFieldUnchanged() async throws {
        let (transport, api) = signedIn { request in
            .success((200, request.httpMethod == "POST" ? config(par: 5, overridden: true, revision: 4) : config(par: 3, overridden: false)))
        }
        let model = await StorePARModel(api: api, storeID: "s1")
        await model.load()
        let item = try #require(await model.config?.items.first)
        await MainActor.run { model.inputs["i1"] = "5" }
        await model.save(item)
        let post = try #require(transport.requests.last)
        #expect(post.url?.path == "/api/v1/production/s1")
        #expect(post.value(forHTTPHeaderField: "Idempotency-Key") != nil)
        let sent = body(post)
        #expect(sent["action"] as? String == "configure")
        #expect(sent["item_id"] as? String == "i1")
        #expect(sent["par"] as? Int == 5)
        #expect(sent["expected_revision"] as? Int == 3)
        #expect(sent["section"] as? String == "fruit_4ft")
        #expect(sent["category"] as? String == "Shelf 5")
        #expect(sent["sort_order"] as? Int == 9)
        #expect(sent["active"] as? Bool == true)
        #expect(await model.config?.items.first?.canReset == true)
        #expect(await model.savedItem == "i1")
        #expect(await model.inputs["i1"] == "5")
    }

    @Test func resetSendsTheDefaultPar() async throws {
        let (transport, api) = signedIn { request in
            .success((200, request.httpMethod == "POST" ? config(par: 3, overridden: false, revision: 5) : config(par: 5, overridden: true, revision: 4)))
        }
        let model = await StorePARModel(api: api, storeID: "s1")
        await model.load()
        let item = try #require(await model.config?.items.first)
        #expect(item.canReset)
        await model.reset(item)
        #expect(body(try #require(transport.requests.last))["par"] as? Int == 3)
        #expect(await model.config?.items.first?.par_overridden == false)
    }

    @Test func unchangedOrEmptyInputIsNotSent() async throws {
        let (transport, api) = signedIn { _ in .success((200, config(par: 3, overridden: false))) }
        let model = await StorePARModel(api: api, storeID: "s1")
        await model.load()
        let item = try #require(await model.config?.items.first)
        await model.save(item)
        await MainActor.run { model.inputs["i1"] = "" }
        #expect(await model.isInvalid(item))
        await model.save(item)
        #expect(transport.requests.allSatisfy { $0.httpMethod == "GET" })
    }

    @Test func conflictReloadsAndKeepsOtherUnsavedEdits() async throws {
        let (transport, api) = signedIn { _ in .success((200, config(par: 3, overridden: false))) }
        let model = await StorePARModel(api: api, storeID: "s1")
        await model.load()
        let item = try #require(await model.config?.items.first)
        await MainActor.run { model.inputs["i1"] = "7"; model.inputs["i2"] = "9" }
        transport.setHandler { request in
            request.httpMethod == "POST"
                ? .success((409, #"{"error":{"code":"CONFLICT","message":"Conflict."},\#(envelope)}"#))
                : .success((200, config(par: 4, overridden: true, revision: 6)))
        }
        await model.save(item)
        #expect(await model.error?.contains("Someone else") == true)
        #expect(await model.config?.items.first?.revision == 6)
        #expect(await model.inputs["i1"] == "4")
        #expect(await model.inputs["i2"] == "9")
    }

    @Test func uncertainSaveRetriesWithTheSameKey() async throws {
        let (transport, api) = signedIn { _ in .success((200, config(par: 3, overridden: false))) }
        let model = await StorePARModel(api: api, storeID: "s1")
        await model.load()
        let item = try #require(await model.config?.items.first)
        await MainActor.run { model.inputs["i1"] = "8" }
        transport.setHandler { _ in .failure(URLError(.timedOut)) }
        await model.save(item)
        #expect(await model.error != nil)
        transport.setHandler { _ in .success((200, config(par: 8, overridden: true, revision: 4))) }
        await model.save(item)
        let keys = transport.requests.filter { $0.httpMethod == "POST" }.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }
        #expect(keys.count >= 2)
        #expect(Set(keys).count == 1)
    }
}
