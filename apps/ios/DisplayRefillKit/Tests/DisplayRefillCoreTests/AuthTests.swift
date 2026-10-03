import Foundation
import Testing
@testable import DisplayRefillCore

// MARK: - Test doubles

/// Records requests and answers from a routing closure. Thread-safe.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) -> Result<(Int, String), URLError>
    private let lock = NSLock()
    private var handler: Handler
    private(set) var requests: [URLRequest] = []

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    func setHandler(_ handler: @escaping Handler) {
        lock.withLock { self.handler = handler }
    }

    func send(_ request: URLRequest) async throws(URLError) -> (Data, HTTPURLResponse) {
        let handler = lock.withLock {
            requests.append(request)
            return self.handler
        }
        // Yield so concurrent callers genuinely overlap.
        try? await Task.sleep(for: .milliseconds(20))
        switch handler(request) {
        case .success(let (status, body)):
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        case .failure(let error):
            throw error
        }
    }

    func count(_ match: String) -> Int {
        lock.withLock { requests.filter { ($0.url?.absoluteString ?? "").contains(match) }.count }
    }
}

private let supabaseURL = URL(string: "http://127.0.0.1:54321")!
private let apiURL = URL(string: "http://localhost:3000")!
private let userID = UUID(uuidString: "6f0a3c1e-1111-4111-8111-111111111111")!
private let storeID = "20000000-0000-4000-8000-0000000000a1"

private func tokenJSON(access: String, refresh: String, expiresAt: Date) -> String {
    #"{"access_token":"\#(access)","token_type":"bearer","expires_in":3600,"expires_at":\#(Int(expiresAt.timeIntervalSince1970)),"refresh_token":"\#(refresh)","user":{"id":"\#(userID.uuidString.lowercased())","email":"e@example.com"}}"#
}

private let meJSON = #"""
{"data":{"user_id":"6f0a3c1e-1111-4111-8111-111111111111","email":"e@example.com","display_name":"E","organizations":[{"organization_id":"10000000-0000-4000-8000-00000000000a","name":"Org A","role":"member"}],"stores":[{"store_id":"20000000-0000-4000-8000-0000000000a1","organization_id":"10000000-0000-4000-8000-00000000000a","name":"A Store 1","store_number":"A-001","timezone":"America/Los_Angeles","role":"employee"}],"capabilities":{"dashboard":false,"admin_organization_ids":[]}},"request_id":"0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10"}
"""#

private func errorJSON(_ code: String) -> String {
    #"{"error":{"code":"\#(code)","message":"m","field_errors":{}},"request_id":"0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10"}"#
}

private func session(access: String = "access-1", refresh: String = "refresh-1", expiresIn: TimeInterval = 3600) -> AuthSession {
    AuthSession(accessToken: access, refreshToken: refresh, expiresAt: Date().addingTimeInterval(expiresIn), userID: userID, email: "e@example.com")
}

private func bearer(_ request: URLRequest) -> String? {
    request.value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(of: "Bearer ", with: "")
}

private struct Fixture {
    let transport: StubTransport
    let store: InMemorySessionStore
    let sessions: SessionManager
    let account: URLSessionAccountAPI

    init(saved: AuthSession?, _ handler: @escaping StubTransport.Handler) {
        transport = StubTransport(handler)
        store = InMemorySessionStore(saved)
        let auth = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "sb_publishable_test", transport: transport)
        sessions = SessionManager(auth: auth, store: store)
        account = URLSessionAccountAPI(baseURL: apiURL, sessions: sessions, transport: transport)
    }
}

// MARK: - Sign-in and persistence

@Suite struct SignInTests {
    @Test func signInStoresSessionAndSendsOnlyPublicKey() async throws {
        let expires = Date().addingTimeInterval(3600)
        let f = Fixture(saved: nil) { _ in .success((200, tokenJSON(access: "a1", refresh: "r1", expiresAt: expires))) }
        let s = try await f.sessions.signIn(email: "e@example.com", password: "correct horse battery")
        #expect(s.accessToken == "a1")
        #expect(s.userID == userID)
        #expect(try f.store.load() == s)
        let request = try #require(f.transport.requests.first)
        #expect(request.url?.absoluteString == "http://127.0.0.1:54321/auth/v1/token?grant_type=password")
        #expect(request.value(forHTTPHeaderField: "apikey") == "sb_publishable_test")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func wrongPasswordStoresNothing() async throws {
        let f = Fixture(saved: nil) { _ in .success((400, #"{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"#)) }
        await #expect(throws: AuthError.invalidCredentials) { try await f.sessions.signIn(email: "e@example.com", password: "nope-nope-nope") }
        #expect(try f.store.load() == nil)
    }

    @Test func rateLimitAndOfflineAreDistinct() async {
        let limited = Fixture(saved: nil) { _ in .success((429, "{}")) }
        await #expect(throws: AuthError.rateLimited) { try await limited.sessions.signIn(email: "e@example.com", password: "x") }
        let offline = Fixture(saved: nil) { _ in .failure(URLError(.notConnectedToInternet)) }
        await #expect(throws: AuthError.transport(.notConnectedToInternet)) { try await offline.sessions.signIn(email: "e@example.com", password: "x") }
    }

    @Test func restoresSavedSessionOnLaunch() async {
        let saved = session()
        let f = Fixture(saved: saved) { _ in .failure(URLError(.badURL)) }
        #expect(await f.sessions.restore() == saved)
    }
}

// MARK: - Refresh

@Suite struct RefreshTests {
    @Test func expiringTokenIsRefreshedBeforeUseAndPersisted() async throws {
        let f = Fixture(saved: session(expiresIn: 30)) { request in
            if request.url!.absoluteString.contains("grant_type=refresh_token") {
                return .success((200, tokenJSON(access: "access-2", refresh: "refresh-2", expiresAt: Date().addingTimeInterval(3600))))
            }
            return .success((200, meJSON))
        }
        let me = try await f.account.me()
        #expect(me.stores.map(\.storeID.uuidString).map { $0.lowercased() } == [storeID])
        #expect(f.transport.count("grant_type=refresh_token") == 1)
        #expect(bearer(f.transport.requests.last!) == "access-2")
        #expect(try f.store.load()?.refreshToken == "refresh-2")
        let body = try #require(f.transport.requests.first?.httpBody)
        #expect(String(decoding: body, as: UTF8.self).contains("refresh-1"))
    }

    @Test func concurrentCallersShareOneRefresh() async throws {
        let f = Fixture(saved: session(expiresIn: -10)) { request in
            if request.url!.absoluteString.contains("grant_type=refresh_token") {
                return .success((200, tokenJSON(access: "access-2", refresh: "refresh-2", expiresAt: Date().addingTimeInterval(3600))))
            }
            return .success((200, meJSON))
        }
        try await withThrowingTaskGroup(of: Me.self) { group in
            for _ in 0..<5 { group.addTask { try await f.account.me() } }
            for try await _ in group {}
        }
        #expect(f.transport.count("grant_type=refresh_token") == 1)
        #expect(await f.sessions.refreshCount == 1)
        #expect(f.transport.count("/api/v1/me") == 5)
    }

    @Test func unauthorizedRefreshesOnceAndRetriesOnce() async throws {
        let f = Fixture(saved: session()) { request in
            if request.url!.absoluteString.contains("grant_type=refresh_token") {
                return .success((200, tokenJSON(access: "access-2", refresh: "refresh-2", expiresAt: Date().addingTimeInterval(3600))))
            }
            return bearer(request) == "access-1" ? .success((401, errorJSON("UNAUTHENTICATED"))) : .success((200, meJSON))
        }
        _ = try await f.account.me()
        #expect(f.transport.requests.map { $0.url!.path() } == ["/api/v1/me", "/auth/v1/token", "/api/v1/me"])
    }

    @Test func secondUnauthorizedEndsSessionWithoutLooping() async throws {
        let f = Fixture(saved: session()) { request in
            if request.url!.absoluteString.contains("grant_type=refresh_token") {
                return .success((200, tokenJSON(access: "access-2", refresh: "refresh-2", expiresAt: Date().addingTimeInterval(3600))))
            }
            return .success((401, errorJSON("UNAUTHENTICATED")))
        }
        var events = f.sessions.signedOutEvents.makeAsyncIterator()
        await #expect(throws: APIClientError.signedOut) { try await f.account.me() }
        #expect(f.transport.requests.count == 3) // me, refresh, me — then stop
        #expect(try f.store.load() == nil)
        #expect(await f.sessions.currentSession == nil)
        #expect(await events.next() != nil)
        // Later calls fail fast without any network request.
        await #expect(throws: APIClientError.signedOut) { try await f.account.me() }
        #expect(f.transport.requests.count == 3)
    }

    @Test func rejectedRefreshTokenSignsOutAfterOneAttempt() async throws {
        let f = Fixture(saved: session()) { request in
            if request.url!.absoluteString.contains("grant_type=refresh_token") {
                return .success((400, #"{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token"}"#))
            }
            return .success((401, errorJSON("UNAUTHENTICATED")))
        }
        await #expect(throws: APIClientError.signedOut) { try await f.account.me() }
        #expect(f.transport.count("grant_type=refresh_token") == 1)
        #expect(f.transport.count("/api/v1/me") == 1) // no retry without a new token
        #expect(try f.store.load() == nil)
    }

    @Test func networkFailureDuringRefreshKeepsTheSession() async throws {
        let saved = session(expiresIn: -10)
        let f = Fixture(saved: saved) { _ in .failure(URLError(.timedOut)) }
        await #expect(throws: APIClientError.transport(.timedOut)) { try await f.account.me() }
        #expect(try f.store.load() == saved)
        #expect(await f.sessions.currentSession == saved)
        // Connectivity returns: the same refresh token still works.
        f.transport.setHandler { request in
            if request.url!.absoluteString.contains("grant_type=refresh_token") {
                return .success((200, tokenJSON(access: "access-2", refresh: "refresh-2", expiresAt: Date().addingTimeInterval(3600))))
            }
            return .success((200, meJSON))
        }
        _ = try await f.account.me()
    }

    @Test func revokedMembershipIsForbiddenNotSignedOut() async throws {
        let saved = session()
        let f = Fixture(saved: saved) { _ in .success((403, errorJSON("FORBIDDEN"))) }
        await #expect(throws: APIClientError.server(status: 403, code: .forbidden, message: "m", requestID: UUID(uuidString: "0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10"))) {
            try await f.account.me()
        }
        #expect(f.transport.count("grant_type=refresh_token") == 0)
        #expect(try f.store.load() == saved)
    }

    @Test func noSessionMeansSignedOutWithoutNetwork() async {
        let f = Fixture(saved: nil) { _ in .failure(URLError(.badURL)) }
        await #expect(throws: APIClientError.signedOut) { try await f.account.me() }
        #expect(f.transport.requests.isEmpty)
    }
}

// MARK: - Sign-out and local data

@Suite struct SignOutTests {
    @Test func signOutClearsKeychainThenRevokesWithServer() async throws {
        let f = Fixture(saved: session()) { _ in .success((204, "")) }
        _ = await f.sessions.restore()
        await f.sessions.signOut()
        #expect(try f.store.load() == nil)
        let logout = try #require(f.transport.requests.first)
        #expect(logout.url?.absoluteString == "http://127.0.0.1:54321/auth/v1/logout?scope=local")
        #expect(bearer(logout) == "access-1")
    }

    @Test func signOutStillClearsLocallyWhenOffline() async throws {
        let f = Fixture(saved: session()) { _ in .failure(URLError(.notConnectedToInternet)) }
        _ = await f.sessions.restore()
        await f.sessions.signOut()
        #expect(try f.store.load() == nil)
        await #expect(throws: APIClientError.signedOut) { try await f.account.me() }
    }

    @Test func localDataCleanerRemovesImageDirectories() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "DisplayRefillTest-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("photo".utf8).write(to: dir.appending(path: "scan.jpg"))
        AppLocalDataCleaner(directories: [dir]).removeAll()
        #expect(!FileManager.default.fileExists(atPath: dir.path()))
    }

    @Test func sessionCodableRoundTripUsesSnakeCase() throws {
        let s = session()
        let data = try JSONCoding.makeEncoder().encode(s)
        let json = String(decoding: data, as: UTF8.self)
        #expect(json.contains("\"refresh_token\""))
        #expect(try JSONCoding.makeDecoder().decode(AuthSession.self, from: data).refreshToken == s.refreshToken)
    }
}

/// Exercises the real Keychain. Opt-in (`DISPLAY_REFILL_KEYCHAIN_TEST=1`)
/// because it writes to the login keychain of the machine running tests.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["DISPLAY_REFILL_KEYCHAIN_TEST"] == "1"))
struct KeychainTests {
    @Test func saveLoadDelete() throws {
        let store = KeychainSessionStore(service: "com.displayrefill.tests.\(UUID().uuidString)")
        let s = session()
        try store.save(s)
        let loaded = try #require(try store.load())
        #expect(loaded.accessToken == s.accessToken && loaded.refreshToken == s.refreshToken && loaded.userID == s.userID)
        // RFC3339 storage keeps milliseconds; Date() carries finer precision.
        #expect(abs(loaded.expiresAt.timeIntervalSince(s.expiresAt)) < 0.001)
        try store.save(session(access: "access-2"))
        #expect(try store.load()?.accessToken == "access-2")
        try store.delete()
        #expect(try store.load() == nil)
    }
}
