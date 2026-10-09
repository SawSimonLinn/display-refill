import Foundation

/// Supabase Auth operations the app needs: email/password. Sign-up with an
/// email code is the separate `SignUpAPI` (Feature 16), Apple and Google are
/// `SocialAuthAPI`; invitations still work.
public protocol SupabaseAuthAPI: Sendable {
    func signIn(email: String, password: String) async throws(AuthError) -> AuthSession
    func refresh(refreshToken: String) async throws(AuthError) -> AuthSession
    /// Revokes this device's session (`scope=local`). Best effort.
    func signOut(accessToken: String) async throws(AuthError)
}

/// Talks to Supabase Auth's HTTP endpoints (`/auth/v1/token`, `/auth/v1/logout`)
/// with the publishable key, the same endpoints the Supabase SDKs call.
/// Kept behind `SupabaseAuthAPI` so it can be swapped for supabase-swift once
/// the iOS toolchain can build package dependencies (decision D31).
public struct SupabaseAuthClient: SupabaseAuthAPI {
    let supabaseURL: URL
    private let publishableKey: String
    private let transport: any HTTPTransport
    private let now: @Sendable () -> Date

    public init(supabaseURL: URL, publishableKey: String, transport: any HTTPTransport = URLSessionTransport(), now: @escaping @Sendable () -> Date = Date.init) {
        self.supabaseURL = supabaseURL
        self.publishableKey = publishableKey
        self.transport = transport
        self.now = now
    }

    public func signIn(email: String, password: String) async throws(AuthError) -> AuthSession {
        let (data, response) = try await post("auth/v1/token", query: "grant_type=password", body: ["email": email, "password": password])
        switch response.statusCode {
        case 200: return try decodeSession(data)
        case 429: throw .rateLimited
        case 400, 401, 403, 422: throw .invalidCredentials
        default: throw .unexpected(status: response.statusCode)
        }
    }

    public func refresh(refreshToken: String) async throws(AuthError) -> AuthSession {
        let (data, response) = try await post("auth/v1/token", query: "grant_type=refresh_token", body: ["refresh_token": refreshToken])
        switch response.statusCode {
        case 200: return try decodeSession(data)
        case 429: throw .rateLimited
        // Revoked, reused outside the reuse window, or unknown refresh token.
        case 400, 401, 403, 404, 422: throw .sessionExpired
        default: throw .unexpected(status: response.statusCode)
        }
    }

    public func signOut(accessToken: String) async throws(AuthError) {
        let (_, response) = try await post("auth/v1/logout", query: "scope=local", body: [:], bearer: accessToken)
        // 401/403/404: the session is already gone, which is the goal.
        guard (200..<300).contains(response.statusCode) || [401, 403, 404].contains(response.statusCode) else {
            throw .unexpected(status: response.statusCode)
        }
    }

    private func post(_ path: String, query: String, body: [String: String], bearer: String? = nil) async throws(AuthError) -> (Data, HTTPURLResponse) {
        guard var components = URLComponents(url: supabaseURL.appending(path: path), resolvingAgainstBaseURL: false) else {
            throw .unexpected(status: 0)
        }
        components.percentEncodedQuery = query
        guard let url = components.url else { throw .unexpected(status: 0) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            return try await transport.send(request)
        } catch {
            throw .transport(error.code)
        }
    }

    /// JSON request with a nested body (sign-up metadata, social sign-in), publishable key
    /// and optional user token.
    func postJSON(_ path: String, query: String? = nil, method: String = "POST", body: [String: Any], bearer: String? = nil) async throws(AuthError) -> (Data, HTTPURLResponse) {
        guard var components = URLComponents(url: supabaseURL.appending(path: path), resolvingAgainstBaseURL: false) else {
            throw .unexpected(status: 0)
        }
        components.percentEncodedQuery = query
        guard let url = components.url else { throw .unexpected(status: 0) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            return try await transport.send(request)
        } catch {
            throw .transport(error.code)
        }
    }

    private struct TokenResponse: Decodable {
        struct User: Decodable {
            let id: UUID
            let email: String?
        }

        let accessToken: String
        let refreshToken: String
        let expiresIn: Double?
        let expiresAt: Double?
        let user: User

        enum CodingKeys: String, CodingKey {
            case user
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
            case expiresAt = "expires_at"
        }
    }

    func decodeSession(_ data: Data) throws(AuthError) -> AuthSession {
        guard let token = try? JSONDecoder().decode(TokenResponse.self, from: data), !token.accessToken.isEmpty, !token.refreshToken.isEmpty else {
            throw .unexpected(status: 200)
        }
        let expiresAt = token.expiresAt.map { Date(timeIntervalSince1970: $0) } ?? now().addingTimeInterval(token.expiresIn ?? 0)
        return AuthSession(accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: expiresAt, userID: token.user.id, email: token.user.email)
    }
}
