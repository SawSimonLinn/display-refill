import AuthenticationServices
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
        /// New account: access code, then create or join a store (Feature 16).
        case onboarding(OnboardingStatus)
        case failed(String)
    }

    public private(set) var phase: Phase = .restoring
    public private(set) var signInError: String?
    /// Sign-up form/code errors, shown on the sign-up screen.
    public private(set) var signUpError: String?
    public private(set) var signUpBusy = false

    private let sessions: SessionManager
    private let account: any AccountAPI
    private let cleaner: any LocalDataCleaner
    public let onboarding: (any OnboardingAPI)?
    private let signUpAPI: (any SignUpAPI)?
    private let social: (any SocialAuthAPI)?
    private var watchTask: Task<Void, Never>?

    public init(sessions: SessionManager, account: any AccountAPI, cleaner: any LocalDataCleaner, onboarding: (any OnboardingAPI)? = nil, signUp: (any SignUpAPI)? = nil,
                social: (any SocialAuthAPI)? = nil) {
        self.sessions = sessions
        self.account = account
        self.cleaner = cleaner
        self.onboarding = onboarding
        self.signUpAPI = signUp
        self.social = social
    }

    public var canSignUp: Bool { signUpAPI != nil && onboarding != nil }
    public var canUseSocialSignIn: Bool { social != nil }

    /// Finishes Sign in with Apple. `fullName` is only present the first time a person
    /// signs in with Apple, so it is saved as the display name then.
    public func signInWithApple(idToken: String, rawNonce: String, fullName: String?) async {
        guard let social else { return }
        signInError = nil
        phase = .signingIn
        let session: AuthSession
        do throws(AuthError) {
            session = try await social.signInWithApple(idToken: idToken, rawNonce: rawNonce)
        } catch {
            showSocialSignInError(error)
            return
        }
        await sessions.adopt(session)
        if let name = fullName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            // Best effort: without it the person shows as "Team member".
            try? await social.updateDisplayName(String(name.prefix(200)), accessToken: session.accessToken)
        }
        await loadAccount()
    }

    /// Google through Supabase's hosted OAuth with PKCE. `authenticate` opens the page in a
    /// web authentication session and returns the callback URL.
    public func signInWithGoogle(authenticate: (URL) async throws -> URL) async {
        guard let social else { return }
        let verifier = SocialSignIn.randomString()
        guard let url = social.googleAuthorizeURL(redirectTo: SocialSignIn.callbackURL, codeChallenge: SocialSignIn.codeChallenge(for: verifier)) else { return }
        signInError = nil
        phase = .signingIn
        let callback: URL
        do {
            callback = try await authenticate(url)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            showSocialSignInError(.cancelled)
            return
        } catch {
            showSocialSignInError(.transport((error as? URLError)?.code ?? .unknown))
            return
        }
        do throws(AuthError) {
            let code = try SocialSignIn.authCode(from: callback)
            await sessions.adopt(try await social.exchangeAuthCode(code, codeVerifier: verifier))
        } catch {
            showSocialSignInError(error)
            return
        }
        await loadAccount()
    }

    /// Back to the sign-in form; a cancelled sheet shows nothing.
    public func showSocialSignInError(_ error: AuthError) {
        phase = .signedOut(notice: nil)
        signInError = error == .cancelled ? nil : Self.message(for: error)
    }

    /// Creates the account; Supabase emails a 6-digit code. Returns true when the code step should show.
    public func signUp(email: String, password: String, name: String) async -> Bool {
        guard let signUpAPI else { return false }
        signUpError = nil; signUpBusy = true
        defer { signUpBusy = false }
        do throws(AuthError) {
            try await signUpAPI.signUp(email: Self.normalized(email), password: password, displayName: name.trimmingCharacters(in: .whitespacesAndNewlines))
            return true
        } catch {
            signUpError = Self.message(for: error)
            return false
        }
    }

    /// Confirms the emailed code, keeps the session and continues to onboarding.
    public func confirmSignUp(email: String, code: String) async {
        guard let signUpAPI else { return }
        signUpError = nil; signUpBusy = true
        do throws(AuthError) {
            let session = try await signUpAPI.verifySignUpCode(email: Self.normalized(email), code: code.filter(\.isNumber))
            await sessions.adopt(session)
        } catch {
            signUpBusy = false
            signUpError = Self.message(for: error)
            return
        }
        signUpBusy = false
        await loadAccount()
    }

    public func resendSignUpCode(email: String) async -> Bool {
        guard let signUpAPI else { return false }
        signUpError = nil
        do throws(AuthError) {
            try await signUpAPI.resendSignUpCode(email: Self.normalized(email))
            return true
        } catch {
            signUpError = Self.message(for: error)
            return false
        }
    }

    private static func normalized(_ email: String) -> String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

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
            let me = try await account.me()
            // A member with no store (not an admin) still has to create or join one.
            if me.stores.isEmpty, me.capabilities.adminOrganizationIDs.isEmpty, let onboarding,
               let status = try? await onboarding.onboardingStatus(), status.state == .store {
                phase = .onboarding(status)
            } else {
                phase = .ready(me)
            }
        } catch {
            switch error {
            case .signedOut:
                await endLocally(notice: "Your session ended. Sign in again.")
            case .server(status: 403, _, _, _):
                // New account (no membership yet) or revoked. Revoked: drop cached account data
                // but keep the session so the user can retry after an admin restores access.
                if let onboarding, let status = try? await onboarding.onboardingStatus(), status.state == .accessCode {
                    phase = .onboarding(status)
                    return
                }
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
        signUpError = nil
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
        case .weakPassword: "Choose a longer password (at least 12 characters) that is hard to guess."
        case .signUpRejected: "That email can't be used. Check it and try again."
        case .invalidCode: "That code is wrong or has expired. Check the latest email or send a new code."
        case .cancelled: "Sign-in was cancelled."
        case .socialSignInFailed: "That sign-in didn't work. Try again, or use your email and password."
        }
    }
}
