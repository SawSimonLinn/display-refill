import DisplayRefillCore
import Observation

/// Checks that the configured API is reachable. Says nothing about sign-in.
@MainActor
@Observable
public final class HealthCheckModel {
    public enum State: Equatable {
        case idle
        case loading
        case reachable(HealthStatus)
        case failed(String)
    }

    public private(set) var state: State = .idle
    private let client: any APIClient

    public init(client: any APIClient) {
        self.client = client
    }

    public func check() async {
        state = .loading
        do throws(APIClientError) {
            state = .reachable(try await client.health())
        } catch {
            state = .failed(Self.message(for: error))
        }
    }

    static func message(for error: APIClientError) -> String {
        switch error {
        case .transport:
            "Can't reach the server. Check your connection and retry."
        case .server(_, .configurationInvalid, _, _):
            "The server is reachable but not configured yet."
        case .server, .unexpectedResponse, .decoding, .signedOut:
            "The server responded unexpectedly. Retry later."
        }
    }
}
