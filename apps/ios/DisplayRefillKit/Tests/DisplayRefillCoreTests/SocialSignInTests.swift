import Foundation
import Testing
@testable import DisplayRefillCore

private let socialSupabaseURL = URL(string: "http://127.0.0.1:54321")!
private let socialTokenJSON = #"{"access_token":"access-s","token_type":"bearer","expires_in":3600,"refresh_token":"refresh-s","user":{"id":"6f0a3c1e-1111-4111-8111-111111111111","email":"g@example.com"}}"#

private func client(_ transport: StubTransport) -> SupabaseAuthClient {
    SupabaseAuthClient(supabaseURL: socialSupabaseURL, publishableKey: "sb_publishable_test", transport: transport)
}

private func jsonBody(_ request: URLRequest) -> [String: Any] {
    (request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
}

@Suite struct SocialSignInTests {
    @Test func appleSendsIDTokenAndRawNonce() async throws {
        let transport = StubTransport { _ in .success((200, socialTokenJSON)) }
        let session = try await client(transport).signInWithApple(idToken: "id-token", rawNonce: "raw")
        #expect(session.accessToken == "access-s")
        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "http://127.0.0.1:54321/auth/v1/token?grant_type=id_token")
        #expect(request.value(forHTTPHeaderField: "apikey") == "sb_publishable_test")
        let body = jsonBody(request)
        #expect(body["provider"] as? String == "apple")
        #expect(body["id_token"] as? String == "id-token")
        #expect(body["nonce"] as? String == "raw")
    }

    @Test func rejectedTokenIsSocialFailure() async {
        let transport = StubTransport { _ in .success((400, #"{"error_code":"provider_disabled"}"#)) }
        await #expect(throws: AuthError.socialSignInFailed) { try await client(transport).signInWithApple(idToken: "t", rawNonce: "n") }
        transport.setHandler { _ in .success((429, "{}")) }
        await #expect(throws: AuthError.rateLimited) { try await client(transport).exchangeAuthCode("c", codeVerifier: "v") }
    }

    @Test func googleAuthorizeURLUsesPKCE() throws {
        let url = try #require(client(StubTransport { _ in .success((200, "{}")) })
            .googleAuthorizeURL(redirectTo: SocialSignIn.callbackURL, codeChallenge: "challenge"))
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.path == "/auth/v1/authorize")
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(query == ["provider": "google", "redirect_to": "displayrefill://auth-callback", "code_challenge": "challenge", "code_challenge_method": "s256"])
    }

    @Test func exchangesCodeWithVerifier() async throws {
        let transport = StubTransport { _ in .success((200, socialTokenJSON)) }
        let session = try await client(transport).exchangeAuthCode("code-1", codeVerifier: "verifier-1")
        #expect(session.email == "g@example.com")
        let request = try #require(transport.requests.first)
        #expect(request.url?.query == "grant_type=pkce")
        #expect(jsonBody(request)["auth_code"] as? String == "code-1")
        #expect(jsonBody(request)["code_verifier"] as? String == "verifier-1")
    }

    @Test func updateDisplayNameSendsUserMetadata() async throws {
        let transport = StubTransport { _ in .success((200, "{}")) }
        try await client(transport).updateDisplayName("Ada Lovelace", accessToken: "access-s")
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "PUT")
        #expect(request.url?.path == "/auth/v1/user")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-s")
        #expect((jsonBody(request)["data"] as? [String: String]) == ["display_name": "Ada Lovelace"])
    }

    @Test func pkceChallengeMatchesRFC7636Example() {
        // RFC 7636 appendix B.
        #expect(SocialSignIn.codeChallenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func randomStringsAreURLSafeAndUnique() {
        let a = SocialSignIn.randomString(), b = SocialSignIn.randomString()
        #expect(a != b)
        #expect(a.count == 43)
        #expect(a.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    }

    @Test func hashedNonceIsHexSHA256() {
        #expect(SocialSignIn.hashedNonce("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func parsesCallback() throws {
        #expect(try SocialSignIn.authCode(from: URL(string: "displayrefill://auth-callback?code=abc")!) == "abc")
        #expect(throws: AuthError.cancelled) { try SocialSignIn.authCode(from: URL(string: "displayrefill://auth-callback?error=access_denied")!) }
        #expect(throws: AuthError.socialSignInFailed) {
            try SocialSignIn.authCode(from: URL(string: "displayrefill://auth-callback#error=server_error&error_description=x")!)
        }
    }
}
