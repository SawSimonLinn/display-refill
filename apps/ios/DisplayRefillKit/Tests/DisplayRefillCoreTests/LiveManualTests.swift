import Foundation
import Testing
@testable import DisplayRefillCore

@Suite(.enabled(if: ProcessInfo.processInfo.environment["DISPLAY_REFILL_MANUAL_LIVE"] == "1"))
struct LiveManualTests {
    @Test @MainActor func actualSwiftClientCompletesLocalManualWorkflowAndRestoresSession() async throws {
        let env = ProcessInfo.processInfo.environment
        let apiString = try #require(env["LIVE_API_BASE_URL"])
        let apiURL = try #require(URL(string: apiString))
        let authString = try #require(env["LIVE_SUPABASE_URL"])
        let authURL = try #require(URL(string: authString))
        try #require(["localhost", "127.0.0.1"].contains(apiURL.host ?? ""))
        try #require(["localhost", "127.0.0.1"].contains(authURL.host ?? ""))
        let auth = SupabaseAuthClient(supabaseURL: authURL, publishableKey: try #require(env["LIVE_PUBLISHABLE_KEY"]))
        let store = InMemorySessionStore()
        let sessions = SessionManager(auth: auth, store: store)
        _ = try await sessions.signIn(email: try #require(env["LIVE_EMAIL"]), password: try #require(env["LIVE_PASSWORD"]))
        let api = URLSessionAccountAPI(baseURL: apiURL, sessions: sessions)
        let me = try await api.me()
        let assigned = try #require(me.stores.first)
        let displays = try await api.displays(store: assigned.storeID.uuidString)
        let display = try #require(displays.first { $0.id == env["LIVE_DISPLAY_ID"] })
        let model = ManualWorkflow(api: api)
        await model.start(display: display)
        let created = try #require(model.scan)
        #expect(created.slots.allSatisfy { $0.acceptedQuantity == nil })
        #expect(!model.valid)
        await model.confirm()
        #expect(model.scan?.revision == 1)
        for slot in created.slots { model.inputs[slot.id] = "0" }
        await model.save()
        let saved = try #require(model.scan)
        #expect(saved.revision == 2)
        #expect(saved.slots.allSatisfy { $0.acceptedQuantity == 0 && $0.reviewState == "verified" })
        #expect(saved.products.allSatisfy { $0.refillQuantity != nil })
        await model.confirm()
        let frozen = try #require(model.scan)
        #expect(frozen.status == "confirmed")
        await model.complete()
        let completed = try #require(model.scan)
        #expect(completed.status == "completed")
        #expect(completed.completedAt != nil && completed.completedBy == me.userID.uuidString.lowercased())
        #expect(completed.slots.map(\.acceptedQuantity) == frozen.slots.map(\.acceptedQuantity))
        #expect(completed.slots.map(\.refillQuantity) == frozen.slots.map(\.refillQuantity))
        // Fresh session manager/client/model; saved ID is a navigation pointer, detail is fetched anew.
        let reopenedAPI = URLSessionAccountAPI(baseURL: apiURL, sessions: SessionManager(auth: auth, store: store))
        let reopened = ManualWorkflow(api: reopenedAPI)
        await reopened.load(id: created.scanID)
        #expect(reopened.scan?.status == "completed")
        #expect(reopened.scan?.totalRefill == completed.totalRefill)
        #expect(reopened.inputs.values.allSatisfy { $0 == "0" })
        await sessions.signOut()
    }
}
