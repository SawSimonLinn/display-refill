import Foundation

/// Owns the signed-in session: Keychain persistence, proactive and on-401
/// refresh, and sign-out.
///
/// Refresh rules (code-standards.md):
/// - Concurrent callers share one refresh request (single flight).
/// - After a 401, refresh at most once for that rejected token; the caller
///   retries once.
/// - A refresh rejected by Supabase Auth ends the session (Keychain item
///   deleted, `signedOutEvents` fires). Network failures keep the session and
///   surface as transport errors, so there is no retry loop either way.
public actor SessionManager {
    private let auth: any SupabaseAuthAPI
    private let store: any SessionStore
    private let now: @Sendable () -> Date
    private var session: AuthSession?
    private var restored = false
    private var inFlightRefresh: Task<AuthSession, any Error>?

    /// Refresh requests started (for tests and diagnostics).
    public private(set) var refreshCount = 0

    /// Fires when the session ends without the user asking (refresh rejected).
    public nonisolated let signedOutEvents: AsyncStream<Void>
    private let signedOutContinuation: AsyncStream<Void>.Continuation

    /// Refresh this long before expiry to avoid sending a token that expires in flight.
    static let expiryLeeway: TimeInterval = 60

    public init(auth: any SupabaseAuthAPI, store: any SessionStore, now: @escaping @Sendable () -> Date = Date.init) {
        self.auth = auth
        self.store = store
        self.now = now
        (signedOutEvents, signedOutContinuation) = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
    }

    /// Loads a saved session from secure storage (once).
    public func restore() -> AuthSession? {
        if !restored {
            restored = true
            session = try? store.load()
        }
        return session
    }

    public var currentSession: AuthSession? { session }

    public func signIn(email: String, password: String) async throws(AuthError) -> AuthSession {
        let new = try await auth.signIn(email: email, password: password)
        session = new
        restored = true
        // A Keychain failure leaves the user signed in for this launch only.
        try? store.save(new)
        return new
    }

    /// Keeps a session obtained outside password sign-in (sign-up email code, Feature 16).
    public func adopt(_ new: AuthSession) {
        session = new
        restored = true
        try? store.save(new)
    }

    /// A token valid for at least `expiryLeeway`, refreshing first if needed.
    public func validAccessToken() async throws(AuthError) -> String {
        guard let current = restore() else { throw .sessionExpired }
        if current.expiresAt.timeIntervalSince(now()) > Self.expiryLeeway { return current.accessToken }
        return try await refresh(from: current).accessToken
    }

    /// Call after the API answered 401 for `rejectedToken`. Returns a newer
    /// token (refreshing once if nobody else already did).
    public func accessTokenAfterUnauthorized(rejectedToken: String) async throws(AuthError) -> String {
        guard let current = session else { throw .sessionExpired }
        if current.accessToken != rejectedToken { return current.accessToken }
        return try await refresh(from: current).accessToken
    }

    /// The API still rejects a freshly refreshed token: end the session.
    public func expire() {
        endSession(notify: true)
    }

    /// User-initiated sign-out: clear local state first, then revoke the
    /// session with Supabase Auth on a best-effort basis.
    public func signOut() async {
        let token = session?.accessToken
        endSession(notify: false)
        if let token { try? await auth.signOut(accessToken: token) }
    }

    private func refresh(from current: AuthSession) async throws(AuthError) -> AuthSession {
        let task: Task<AuthSession, any Error>
        if let inFlightRefresh {
            task = inFlightRefresh
        } else {
            refreshCount += 1
            let auth = self.auth
            task = Task { try await auth.refresh(refreshToken: current.refreshToken) }
            inFlightRefresh = task
        }
        do {
            let new = try await task.value
            if inFlightRefresh == task {
                inFlightRefresh = nil
                session = new
                try? store.save(new)
            }
            return new
        } catch {
            if inFlightRefresh == task { inFlightRefresh = nil }
            let authError = error as? AuthError ?? .unexpected(status: 0)
            if authError == .sessionExpired, session?.refreshToken == current.refreshToken {
                endSession(notify: true)
            }
            throw authError
        }
    }

    private func endSession(notify: Bool) {
        session = nil
        restored = true
        inFlightRefresh = nil
        try? store.delete()
        if notify { signedOutContinuation.yield(()) }
    }
}
