import DisplayRefillCore
import Observation

/// Presentation state for authentication. Holds the signed-in account only
/// in memory; tokens stay in `SessionManager` / Keychain.
@MainActor
@Observable
public final class AppSession {
    public enum Phase: Equatable {
        case restoring
        case signedOut(notice: String?)
        case signingIn
        case loadingAccount
        case ready(Me)
        /// Signed in, but the server reports no active membership (403).
        case accessRemoved
        case failed(String)
    }

    public private(set) var phase: Phase = .restoring
    public private(set) var signInError: String?

    private let sessions: SessionManager
    private let account: any AccountAPI
    private let cleaner: any LocalDataCleaner
    private var watchTask: Task<Void, Never>?

    public init(sessions: SessionManager, account: any AccountAPI, cleaner: any LocalDataCleaner) {
        self.sessions = sessions
        self.account = account
        self.cleaner = cleaner
    }

    /// Restores a saved session and loads the account, or shows sign-in.
    public func start() async {
        watchSignedOutEvents()
        if await sessions.restore() != nil {
            await loadAccount()
        } else {
            phase = .signedOut(notice: nil)
        }
    }

    public func signIn(email: String, password: String) async {
        signInError = nil
        phase = .signingIn
        do throws(AuthError) {
            _ = try await sessions.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), password: password)
        } catch {
            phase = .signedOut(notice: nil)
            signInError = Self.message(for: error)
            return
        }
        await loadAccount()
    }

    public func loadAccount() async {
        phase = .loadingAccount
        do throws(APIClientError) {
            phase = .ready(try await account.me())
        } catch {
            switch error {
            case .signedOut:
                await endLocally(notice: "Your session ended. Sign in again.")
            case .server(status: 403, _, _, _):
                // Revoked: drop cached account data but keep the session so
                // the user can retry after an admin restores access.
                cleaner.removeAll()
                phase = .accessRemoved
            case .transport:
                phase = .failed("Can't reach the server. Check your connection and retry.")
            case .server, .unexpectedResponse, .decoding:
                phase = .failed("Something went wrong loading your account. Retry shortly.")
            }
        }
    }

    public func signOut() async {
        await sessions.signOut()
        await endLocally(notice: nil)
    }

    private func endLocally(notice: String?) async {
        cleaner.removeAll()
        signInError = nil
        phase = .signedOut(notice: notice)
    }

    /// The session manager ends the session when a refresh is rejected.
    private func watchSignedOutEvents() {
        guard watchTask == nil else { return }
        let events = sessions.signedOutEvents
        watchTask = Task { [weak self] in
            for await _ in events {
                guard let self else { return }
                if case .signedOut = self.phase { continue }
                await self.endLocally(notice: "Your session ended. Sign in again.")
            }
        }
    }

    static func message(for error: AuthError) -> String {
        switch error {
        case .invalidCredentials: "Email or password is incorrect."
        case .rateLimited: "Too many attempts. Wait a few minutes and try again."
        case .transport: "Can't reach the server. Check your connection and retry."
        case .sessionExpired, .unexpected: "Sign-in failed. Try again shortly."
        }
    }
}
