import Foundation

/// The single network seam for auth and API calls, so tests can stub every
/// response without a server.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws(URLError) -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    /// Ephemeral by default: no disk cache, no cookie store, so tokens and
    /// account data never land in URLCache.
    public init(session: URLSession = URLSession(configuration: .displayRefill)) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws(URLError) -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            return (data, http)
        } catch let error as URLError {
            throw error
        } catch {
            throw URLError(.unknown)
        }
    }
}

extension URLSessionConfiguration {
    public static var displayRefill: URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        return config
    }
}
