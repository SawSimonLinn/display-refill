import Foundation

public enum APIClientError: Error, Equatable, Sendable {
    /// The server returned the standard error envelope.
    case server(status: Int, code: APIErrorCode, message: String, requestID: UUID?)
    /// Non-JSON or unexpected response; nothing sensitive is retained.
    case unexpectedResponse(status: Int)
    case transport(URLError.Code)
    case decoding
}

/// Network boundary for presentation code; tests and previews use `MockAPIClient`.
public protocol APIClient: Sendable {
    func health() async throws(APIClientError) -> HealthStatus
}

public struct URLSessionAPIClient: APIClient {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func health() async throws(APIClientError) -> HealthStatus {
        try await get("api/v1/health")
    }

    private func get<T: Decodable & Sendable>(_ path: String) async throws(APIClientError) -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(UUID().uuidString.lowercased(), forHTTPHeaderField: "X-Request-Id")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw .transport(error.code)
        } catch {
            throw .transport(.unknown)
        }
        return try APIResponseDecoder.decode(data: data, response: response)
    }
}

/// Shared response handling so mock and live clients behave identically.
public enum APIResponseDecoder {
    public static func decode<T: Decodable & Sendable>(data: Data, response: URLResponse) throws(APIClientError) -> T {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let decoder = JSONCoding.makeDecoder()
        if (200..<300).contains(status) {
            do {
                return try decoder.decode(DataEnvelope<T>.self, from: data).data
            } catch {
                throw .decoding
            }
        }
        if let envelope = try? decoder.decode(ErrorEnvelope.self, from: data) {
            throw .server(status: status, code: envelope.error.code, message: envelope.error.message, requestID: envelope.requestID)
        }
        throw .unexpectedResponse(status: status)
    }
}
