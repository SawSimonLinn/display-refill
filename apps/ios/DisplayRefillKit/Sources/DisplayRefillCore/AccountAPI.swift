import Foundation

/// Authenticated API calls for the signed-in user.
public protocol AccountAPI: Sendable {
    func me() async throws(APIClientError) -> Me
}

/// Sends `Authorization: Bearer <access token>` (no cookies). On 401 it asks
/// the session manager for a refreshed token once and retries once; a second
/// 401 ends the session. 403 means the membership was revoked and is passed
/// through for the UI to explain.
public struct URLSessionAccountAPI: AccountAPI {
    private let baseURL: URL
    private let transport: any HTTPTransport
    private let sessions: SessionManager

    public init(baseURL: URL, sessions: SessionManager, transport: any HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.sessions = sessions
        self.transport = transport
    }

    public func me() async throws(APIClientError) -> Me {
        try await authorizedRequest("api/v1/me")
    }

    func authorizedRequest<T: Decodable & Sendable>(_ path: String, method: String = "GET", body: Data? = nil, key: String? = nil, contentType: String = "application/json") async throws(APIClientError) -> T {
        let token = try await mapAuth { () async throws(AuthError) in try await sessions.validAccessToken() }
        var (data, response) = try await send(path, token: token, method: method, body: body, key: key, contentType: contentType)
        if response.statusCode == 401 {
            let retryToken = try await mapAuth { () async throws(AuthError) in try await sessions.accessTokenAfterUnauthorized(rejectedToken: token) }
            (data, response) = try await send(path, token: retryToken, method: method, body: body, key: key, contentType: contentType)
            if response.statusCode == 401 {
                await sessions.expire()
                throw .signedOut
            }
        }
        return try APIResponseDecoder.decode(data: data, response: response)
    }

    private func send(_ path: String, token: String, method: String, body: Data?, key: String?, contentType: String) async throws(APIClientError) -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: path, relativeTo: baseURL.appending(path: "/"))!)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(UUID().uuidString.lowercased(), forHTTPHeaderField: "X-Request-Id")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            return try await transport.send(request)
        } catch {
            throw .transport(error.code)
        }
    }

    private func mapAuth<T>(_ body: () async throws(AuthError) -> T) async throws(APIClientError) -> T {
        do {
            return try await body()
        } catch {
            switch error {
            case .sessionExpired, .invalidCredentials, .invalidCode: throw .signedOut
            case .weakPassword, .signUpRejected: throw .unexpectedResponse(status: 422)
            case .transport(let code): throw .transport(code)
            case .rateLimited: throw .server(status: 429, code: .rateLimited, message: "Too many requests.", requestID: nil)
            case .unexpected(let status): throw .unexpectedResponse(status: status)
            }
        }
    }
}

/// Removes locally held user data on sign-out: HTTP caches and the app's
/// working directories for captured images (feature 08 writes there).
public protocol LocalDataCleaner: Sendable {
    func removeAll()
}

public struct AppLocalDataCleaner: LocalDataCleaner {
    private let directories: [URL]

    public init(directories: [URL]? = nil) {
        let fm = FileManager.default
        self.directories = directories ?? [
            fm.urls(for: .cachesDirectory, in: .userDomainMask).first?.appending(path: "DisplayRefill"),
            fm.temporaryDirectory.appending(path: "DisplayRefill"),
        ].compactMap { $0 }
    }

    public func removeAll() {
        URLCache.shared.removeAllCachedResponses()
        for directory in directories {
            try? FileManager.default.removeItem(at: directory)
        }
    }
}
