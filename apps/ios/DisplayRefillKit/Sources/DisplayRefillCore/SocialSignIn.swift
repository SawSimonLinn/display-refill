import CryptoKit
import Foundation

/// Sign in (or sign up) with Apple or Google through Supabase Auth.
///
/// - Apple: the native Sign in with Apple sheet returns an ID token, which
///   Supabase verifies (`grant_type=id_token`). The raw nonce goes to Supabase;
///   Apple only ever sees its SHA-256.
/// - Google: Supabase's hosted OAuth flow in a web authentication session with
///   PKCE (`/auth/v1/authorize`, then `grant_type=pkce`), so no Google SDK.
///
/// A first sign-in creates the account. It has no membership yet, so the app
/// continues to the access code step like an email sign-up (Feature 16).
public protocol SocialAuthAPI: Sendable {
    func signInWithApple(idToken: String, rawNonce: String) async throws(AuthError) -> AuthSession
    /// The page that starts Google sign-in; it redirects to `redirectTo?code=…`.
    func googleAuthorizeURL(redirectTo: URL, codeChallenge: String) -> URL?
    func exchangeAuthCode(_ code: String, codeVerifier: String) async throws(AuthError) -> AuthSession
    /// Stores the name Apple shares on first sign-in (Apple's ID token has none).
    func updateDisplayName(_ name: String, accessToken: String) async throws(AuthError)
}

public enum SocialSignIn {
    /// Custom scheme the Google flow returns to. Must be in Supabase Auth's redirect allow list.
    public static let callbackScheme = "displayrefill"
    public static let callbackURL = URL(string: "\(callbackScheme)://auth-callback")!

    /// A random URL-safe string (PKCE verifier, Apple nonce).
    public static func randomString(byteCount: Int = 32) -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<byteCount).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return base64URL(Data(bytes))
    }

    /// PKCE S256 challenge for a verifier.
    public static func codeChallenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// What Apple's request carries as `nonce`: lowercase hex SHA-256 of the raw nonce.
    public static func hashedNonce(_ raw: String) -> String {
        SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// The authorization code from the redirect, or why there is none.
    public static func authCode(from callback: URL) throws(AuthError) -> String {
        let components = URLComponents(url: callback, resolvingAgainstBaseURL: false)
        // Supabase puts errors in the query or, for some failures, the fragment.
        var items = components?.queryItems ?? []
        if let fragment = components?.fragment, let parsed = URLComponents(string: "?" + fragment)?.queryItems {
            items += parsed
        }
        if let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty { return code }
        if items.first(where: { $0.name == "error" })?.value == "access_denied" { throw .cancelled }
        throw .socialSignInFailed
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension SupabaseAuthClient: SocialAuthAPI {
    public func signInWithApple(idToken: String, rawNonce: String) async throws(AuthError) -> AuthSession {
        let (data, response) = try await postJSON("auth/v1/token", query: "grant_type=id_token", body: ["provider": "apple", "id_token": idToken, "nonce": rawNonce])
        return try socialSession(data, response)
    }

    public func googleAuthorizeURL(redirectTo: URL, codeChallenge: String) -> URL? {
        guard var components = URLComponents(url: supabaseURL.appending(path: "auth/v1/authorize"), resolvingAgainstBaseURL: false) else { return nil }
        components.queryItems = [
            .init(name: "provider", value: "google"),
            .init(name: "redirect_to", value: redirectTo.absoluteString),
            .init(name: "code_challenge", value: codeChallenge),
            .init(name: "code_challenge_method", value: "s256"),
        ]
        return components.url
    }

    public func exchangeAuthCode(_ code: String, codeVerifier: String) async throws(AuthError) -> AuthSession {
        let (data, response) = try await postJSON("auth/v1/token", query: "grant_type=pkce", body: ["auth_code": code, "code_verifier": codeVerifier])
        return try socialSession(data, response)
    }

    public func updateDisplayName(_ name: String, accessToken: String) async throws(AuthError) {
        let (_, response) = try await postJSON("auth/v1/user", method: "PUT", body: ["data": ["display_name": name]], bearer: accessToken)
        guard (200..<300).contains(response.statusCode) else { throw .unexpected(status: response.statusCode) }
    }

    private func socialSession(_ data: Data, _ response: HTTPURLResponse) throws(AuthError) -> AuthSession {
        switch response.statusCode {
        case 200: return try decodeSession(data)
        case 429: throw .rateLimited
        // Token or code rejected, provider not enabled, or sign-up disabled.
        case 400, 401, 403, 404, 422: throw .socialSignInFailed
        default: throw .unexpected(status: response.statusCode)
        }
    }
}
