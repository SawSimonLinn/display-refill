import DisplayRefillCore
import SwiftUI

/// Top-level routing. Holds no session: authentication is not implemented.
public struct AppRootView: View {
    private let configuration: Result<AppConfiguration, ConfigurationError>
    private let makeClient: (AppConfiguration) -> any APIClient
    @State private var showingShellPreview = false

    public init(
        configuration: Result<AppConfiguration, ConfigurationError>,
        makeClient: @escaping (AppConfiguration) -> any APIClient = { URLSessionAPIClient(baseURL: $0.apiBaseURL) }
    ) {
        self.configuration = configuration
        self.makeClient = makeClient
    }

    public var body: some View {
        switch configuration {
        case .failure(let error):
            ConfigurationErrorView(error: error)
        case .success(let config):
            if showingShellPreview {
                RootTabView { showingShellPreview = false }
            } else {
                SignInPlaceholderView(client: makeClient(config)) { showingShellPreview = true }
            }
        }
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
    static var previews: some View {
        AppRootView(
            configuration: .success(.init(
                apiBaseURL: URL(string: "http://localhost:3000")!,
                supabaseURL: URL(string: "http://127.0.0.1:54321")!,
                supabasePublishableKey: "sb_publishable_preview"
            )),
            makeClient: { _ in MockAPIClient() }
        )
        .previewDisplayName("Sign-in placeholder")

        AppRootView(configuration: .failure(.init(problems: [.init(key: "API_BASE_URL", problem: "is required")])))
            .previewDisplayName("Configuration error")
    }
}
