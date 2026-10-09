import DisplayRefillCore
import SwiftUI

/// Services the app runs with. Live by default; previews and tests inject doubles.
public struct AppServices: Sendable {
    public let client: any APIClient
    public let sessions: SessionManager
    public let account: any AccountAPI
    public let manual: any ManualScanAPI
    public let cleaner: any LocalDataCleaner
    /// Feature 16 sign-up and onboarding; nil hides "Create account".
    public let onboarding: (any OnboardingAPI)?
    public let signUp: (any SignUpAPI)?
    /// Sign in with Apple / Google; nil hides the buttons.
    public let social: (any SocialAuthAPI)?

    public init(client: any APIClient, sessions: SessionManager, account: any AccountAPI, cleaner: any LocalDataCleaner, manual: any ManualScanAPI,
                onboarding: (any OnboardingAPI)? = nil, signUp: (any SignUpAPI)? = nil, social: (any SocialAuthAPI)? = nil) {
        self.client = client
        self.sessions = sessions
        self.account = account
        self.cleaner = cleaner
        self.manual = manual
        self.onboarding = onboarding
        self.signUp = signUp
        self.social = social
    }

    public static func live(_ config: AppConfiguration) -> AppServices {
        let transport = URLSessionTransport()
        let auth = SupabaseAuthClient(supabaseURL: config.supabaseURL, publishableKey: config.supabasePublishableKey, transport: transport)
        let sessions = SessionManager(auth: auth, store: KeychainSessionStore())
        let api = URLSessionAccountAPI(baseURL: config.apiBaseURL, sessions: sessions, transport: transport)
        return AppServices(
            client: URLSessionAPIClient(baseURL: config.apiBaseURL),
            sessions: sessions,
            account: URLSessionAccountAPI(baseURL: config.apiBaseURL, sessions: sessions, transport: transport),
            cleaner: AppLocalDataCleaner(),
            manual: URLSessionAccountAPI(baseURL: config.apiBaseURL, sessions: sessions, transport: transport),
            onboarding: api,
            signUp: auth,
            social: auth
        )
    }
}

/// Top-level routing: configuration check, then sign-in or the signed-in shell.
public struct AppRootView: View {
    private let configuration: Result<AppConfiguration, ConfigurationError>
    private let makeServices: (AppConfiguration) -> AppServices

    public init(
        configuration: Result<AppConfiguration, ConfigurationError>,
        makeServices: @escaping (AppConfiguration) -> AppServices = AppServices.live
    ) {
        self.configuration = configuration
        self.makeServices = makeServices
    }

    public var body: some View {
        switch configuration {
        case .failure(let error):
            ConfigurationErrorView(error: error)
        case .success(let config):
            SessionRootView(services: makeServices(config))
        }
    }
}

struct SessionRootView: View {
    private let services: AppServices
    @State private var session: AppSession

    init(services: AppServices) {
        self.services = services
        _session = State(initialValue: AppSession(sessions: services.sessions, account: services.account, cleaner: services.cleaner,
                                                  onboarding: services.onboarding, signUp: services.signUp, social: services.social))
    }

    var body: some View {
        Group {
            switch session.phase {
            case .restoring, .loadingAccount:
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.page.ignoresSafeArea())
            case .signedOut, .signingIn:
                SignInView(session: session, client: services.client)
            case .ready(let me):
                SignedInView(me: me, api: services.manual, client: services.client, onReload: session.loadAccount, onSignOut: session.signOut)
            case .accessRemoved:
                AccessRemovedView(onRetry: session.loadAccount, onSignOut: session.signOut)
            case .onboarding(let status):
                if let api = session.onboarding {
                    OnboardingView(status: status, api: api, onDone: session.loadAccount, onSignOut: session.signOut)
                } else {
                    AccessRemovedView(onRetry: session.loadAccount, onSignOut: session.signOut)
                }
            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't load your account", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Retry") { Task { await session.loadAccount() } }
                    Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                }
            }
        }
        .tint(Theme.action)
        .task { await session.start() }
    }
}

struct ConfigurationErrorView: View {
    let error: ConfigurationError

    var body: some View {
        ContentUnavailableView {
            Label("App not configured", systemImage: "wrench.and.screwdriver")
        } description: {
            // Keys and rules only; values are never shown.
            Text(error.problems.map { "\($0.key) \($0.problem)" }.joined(separator: "\n"))
        }
    }
}

// PreviewProvider rather than #Preview: the macro needs Xcode's plugin, and
// this package is also compiled with plain toolchains in CI.
struct AppRootView_Previews: PreviewProvider {
    private struct PreviewAuth: SupabaseAuthAPI {
        func signIn(email: String, password: String) async throws(AuthError) -> AuthSession { throw .invalidCredentials }
        func refresh(refreshToken: String) async throws(AuthError) -> AuthSession { throw .sessionExpired }
        func signOut(accessToken: String) async throws(AuthError) {}
    }

    private struct PreviewAccount: AccountAPI {
        func me() async throws(APIClientError) -> Me { throw .signedOut }
    }

    private struct NoCleanup: LocalDataCleaner {
        func removeAll() {}
    }

    static var previews: some View {
        let config = AppConfiguration(
            apiBaseURL: URL(string: "http://localhost:3000")!,
            supabaseURL: URL(string: "http://127.0.0.1:54321")!,
            supabasePublishableKey: "sb_publishable_preview"
        )
        AppRootView(configuration: .success(config)) { _ in
            AppServices(
                client: MockAPIClient(),
                sessions: SessionManager(auth: PreviewAuth(), store: InMemorySessionStore()),
                account: PreviewAccount(),
                cleaner: NoCleanup(),
                manual: PreviewManual()
            )
        }
        .previewDisplayName("Sign in")

        AppRootView(configuration: .failure(.init(problems: [.init(key: "API_BASE_URL", problem: "is required")])))
            .previewDisplayName("Configuration error")
    }
}

private struct PreviewManual: ManualScanAPI {
    func displays(store: String) async throws -> [ManualDisplay] { [] }
    func detail(id: String) async throws -> ScanDetail { throw APIClientError.signedOut }
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail { throw APIClientError.signedOut }
}
