import Foundation

/// Offline client for previews, tests and UI work before the API exists.
/// Responses are copies of packages/domain/fixtures/api so both clients agree
/// on wire shapes.
public struct MockAPIClient: APIClient {
    public enum Scenario: Sendable {
        case healthy
        case configurationInvalid
        case offline
    }

    private let scenario: Scenario

    public init(scenario: Scenario = .healthy) {
        self.scenario = scenario
    }

    public func health() async throws(APIClientError) -> HealthStatus {
        switch scenario {
        case .healthy:
            return try APIResponseDecoder.decode(data: Fixtures.healthOK, response: Self.response(200))
        case .configurationInvalid:
            return try APIResponseDecoder.decode(data: Fixtures.errorConfigurationInvalid, response: Self.response(503))
        case .offline:
            throw .transport(.notConnectedToInternet)
        }
    }

    private static func response(_ status: Int) -> URLResponse {
        HTTPURLResponse(url: URL(string: "https://mock.invalid/api/v1/health")!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }
}

public enum Fixtures {
    /// packages/domain/fixtures/api/health.ok.json
    public static let healthOK = Data("""
    {
      "data": {
        "status": "ok",
        "service": "admin-api",
        "api_version": "v1",
        "checked_at": "2026-10-02T12:00:00.000Z",
        "checks": {
          "configuration": "ok",
          "database": "not_checked",
          "authentication": "not_implemented",
          "job_queue": "not_implemented"
        }
      },
      "request_id": "0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10"
    }
    """.utf8)

    /// packages/domain/fixtures/api/error.configuration-invalid.json
    public static let errorConfigurationInvalid = Data("""
    {
      "error": {
        "code": "CONFIGURATION_INVALID",
        "message": "The server is missing required configuration. See the server log.",
        "field_errors": {}
      },
      "request_id": "4f6c1d2e-8b7a-4e3f-9c10-2d3e4f5a6b7c"
    }
    """.utf8)
}
