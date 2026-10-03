import Foundation
import Testing
@testable import DisplayRefillCore

/// Runs the real auth client against a LOCAL stack (Supabase Auth + admin
/// API). Opt-in: set DISPLAY_REFILL_LIVE=1 plus LIVE_API_BASE_URL,
/// LIVE_SUPABASE_URL, LIVE_PUBLISHABLE_KEY, LIVE_EMAIL, LIVE_PASSWORD and
/// LIVE_EXPECTED_STORE_IDS (comma-separated). See apps/ios/README.md.
private let env = ProcessInfo.processInfo.environment

@Suite(.enabled(if: env["DISPLAY_REFILL_LIVE"] == "1"), .serialized)
struct LiveAuthTests {
    let apiURL = URL(string: env["LIVE_API_BASE_URL"] ?? "http://localhost:3100")!
    let supabaseURL = URL(string: env["LIVE_SUPABASE_URL"] ?? "http://127.0.0.1:54321")!
    let key = env["LIVE_PUBLISHABLE_KEY"] ?? ""
    let email = env["LIVE_EMAIL"] ?? ""
    let password = env["LIVE_PASSWORD"] ?? ""
    let expectedStores = Set((env["LIVE_EXPECTED_STORE_IDS"] ?? "").split(separator: ",").map { $0.lowercased() })

    init() throws {
        for host in [apiURL.host(), supabaseURL.host()] {
            try #require(["localhost", "127.0.0.1"].contains(host ?? ""), "live tests run against loopback only")
        }
    }

    private func make(_ store: InMemorySessionStore = InMemorySessionStore()) -> (SessionManager, URLSessionAccountAPI) {
        let transport = URLSessionTransport()
        let sessions = SessionManager(auth: SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: key, transport: transport), store: store)
        return (sessions, URLSessionAccountAPI(baseURL: apiURL, sessions: sessions, transport: transport))
    }

    private func rawMe(_ token: String) async throws -> Int {
        var request = URLRequest(url: apiURL.appending(path: "api/v1/me"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await URLSessionTransport().send(request).1.statusCode
    }

    @Test func signInLoadsOnlyAuthorizedStoresThenRefreshesAndSignsOut() async throws {
        let (sessions, account) = make()
        await #expect(throws: AuthError.invalidCredentials) { try await sessions.signIn(email: email, password: "wrong-\(password)") }

        let session = try await sessions.signIn(email: email, password: password)
        let me = try await account.me()
        #expect(Set(me.stores.map { $0.storeID.uuidString.lowercased() }) == expectedStores)
        #expect(me.capabilities.dashboard == false)

        // A launch with an expired access token refreshes once and continues.
        let expired = AuthSession(accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: .distantPast, userID: session.userID, email: session.email)
        let restoredStore = InMemorySessionStore(expired)
        let (restored, restoredAccount) = make(restoredStore)
        _ = try await restoredAccount.me()
        #expect(await restored.refreshCount == 1)
        let rotated = try #require(try restoredStore.load())
        #expect(rotated.refreshToken != session.refreshToken)

        // Sign-out revokes the session server-side; the old access token stops working.
        await restored.signOut()
        #expect(try restoredStore.load() == nil)
        let afterSignOut = try await rawMe(rotated.accessToken)
        #expect(afterSignOut == 401, "status after sign-out: \(afterSignOut)")
    }

    @Test func invalidRefreshTokenReturnsToSignInWithoutLooping() async throws {
        let bogus = AuthSession(accessToken: "x.y.z", refreshToken: "not-a-real-refresh-token", expiresAt: .distantPast, userID: UUID(), email: nil)
        let store = InMemorySessionStore(bogus)
        let (sessions, account) = make(store)
        await #expect(throws: APIClientError.signedOut) { try await account.me() }
        #expect(await sessions.refreshCount == 1)
        #expect(try store.load() == nil)
    }

    @Test func passwordResetRequestIsAccepted() async throws {
        let ack = try await URLSessionAPIClient(baseURL: apiURL).requestPasswordReset(email: "nobody-\(UUID().uuidString.prefix(8))@example.com")
        #expect(ack.status == "sent_if_registered")
    }
}
