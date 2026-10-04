import Foundation
import Testing
@testable import DisplayRefillCore

private let validInfo: [String: String] = [
    "API_BASE_URL": "http://localhost:3000",
    "SUPABASE_URL": "http://127.0.0.1:54321",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_example",
]

private func fakeJWT(role: String) -> String {
    let payload = Data(#"{"role":"\#(role)"}"#.utf8).base64EncodedString()
        .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    return "e30.\(payload).sig"
}

@Suite struct AppConfigurationTests {
    @Test func acceptsPublishableConfiguration() throws {
        let config = try AppConfiguration(infoDictionary: validInfo)
        #expect(config.apiBaseURL.absoluteString == "http://localhost:3000")
    }

    @Test func reportsMissingAndUnexpandedKeys() {
        var info = validInfo
        info["API_BASE_URL"] = "$(API_BASE_URL)"
        info["SUPABASE_URL"] = nil
        #expect(throws: ConfigurationError.self) { try AppConfiguration(infoDictionary: info) }
        do {
            _ = try AppConfiguration(infoDictionary: info)
        } catch {
            #expect(error.problems.map(\.key) == ["API_BASE_URL", "SUPABASE_URL"])
        }
    }

    @Test(arguments: ["sb_secret_abc123", fakeJWT(role: "service_role")])
    func rejectsSecretKeysWithoutPrintingThem(key: String) {
        var info = validInfo
        info["SUPABASE_PUBLISHABLE_KEY"] = key
        do {
            _ = try AppConfiguration(infoDictionary: info)
            Issue.record("expected failure")
        } catch {
            #expect(error.problems.map(\.key) == ["SUPABASE_PUBLISHABLE_KEY"])
            #expect(!error.description.contains(key))
        }
    }

    @Test func acceptsLegacyAnonJWT() throws {
        var info = validInfo
        info["SUPABASE_PUBLISHABLE_KEY"] = fakeJWT(role: "anon")
        _ = try AppConfiguration(infoDictionary: info)
    }

    @Test func rejectsBundledServerSecrets() {
        var info = validInfo
        info["DATABASE_URL"] = "postgresql://x"
        do {
            _ = try AppConfiguration(infoDictionary: info)
            Issue.record("expected failure")
        } catch {
            #expect(error.problems.map(\.key) == ["DATABASE_URL"])
        }
    }

    @Test func rejectsNonHTTPURL() {
        var info = validInfo
        info["API_BASE_URL"] = "ftp://example.com"
        #expect(throws: ConfigurationError.self) { try AppConfiguration(infoDictionary: info) }
    }
}

@Suite struct WireFormatTests {
    @Test func decodesHealthFixture() async throws {
        let health = try await MockAPIClient().health()
        #expect(health.apiVersion == "v1")
        #expect(health.checks.authentication == "not_checked")
        #expect(health.checks.jobQueue == "not_checked")
    }

    @Test func decodesErrorEnvelope() async {
        do {
            _ = try await MockAPIClient(scenario: .configurationInvalid).health()
            Issue.record("expected failure")
        } catch {
            guard case .server(503, .configurationInvalid, _, let requestID) = error else {
                Issue.record("unexpected \(error)")
                return
            }
            #expect(requestID != nil)
        }
    }

    @Test func unknownErrorCodesDoNotFailDecoding() throws {
        let json = Data(#"{"error":{"code":"SOMETHING_NEW","message":"m"},"request_id":"4f6c1d2e-8b7a-4e3f-9c10-2d3e4f5a6b7c"}"#.utf8)
        let envelope = try JSONCoding.makeDecoder().decode(ErrorEnvelope.self, from: json)
        #expect(envelope.error.code == .unknown("SOMETHING_NEW"))
        #expect(envelope.error.fieldErrors.isEmpty)
    }

    @Test func nonJSONErrorIsUnexpectedResponse() {
        let response = HTTPURLResponse(url: URL(string: "https://x.invalid")!, statusCode: 502, httpVersion: nil, headerFields: nil)!
        #expect(throws: APIClientError.unexpectedResponse(status: 502)) {
            let _: HealthStatus = try APIResponseDecoder.decode(data: Data("<html>".utf8), response: response)
        }
    }

    @Test func rfc3339RoundTrip() throws {
        #expect(JSONCoding.parseRFC3339("2026-10-02T12:00:00Z") != nil)
        let date = try #require(JSONCoding.parseRFC3339("2026-10-02T12:00:00.250Z"))
        #expect(JSONCoding.formatRFC3339(date) == "2026-10-02T12:00:00.250Z")
        #expect(JSONCoding.parseRFC3339("02/10/2026") == nil)
    }
}
