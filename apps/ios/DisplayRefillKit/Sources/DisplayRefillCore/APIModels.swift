import Foundation

/// `{ "data": ..., "request_id": "..." }`
public struct DataEnvelope<Payload: Decodable & Sendable>: Decodable, Sendable {
    public let data: Payload
    public let requestID: UUID

    enum CodingKeys: String, CodingKey {
        case data
        case requestID = "request_id"
    }
}

/// `{ "error": { "code", "message", "field_errors" }, "request_id": "..." }`
public struct ErrorEnvelope: Decodable, Sendable, Equatable {
    public struct Body: Decodable, Sendable, Equatable {
        public let code: APIErrorCode
        public let message: String
        public let fieldErrors: [String: [String]]

        enum CodingKeys: String, CodingKey {
            case code, message
            case fieldErrors = "field_errors"
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = try c.decode(APIErrorCode.self, forKey: .code)
            message = try c.decode(String.self, forKey: .message)
            fieldErrors = try c.decodeIfPresent([String: [String]].self, forKey: .fieldErrors) ?? [:]
        }
    }

    public let error: Body
    public let requestID: UUID

    enum CodingKeys: String, CodingKey {
        case error
        case requestID = "request_id"
    }
}

/// Stable codes from packages/domain/src/api.ts. Unrecognised codes decode
/// to `.unknown` so newer servers do not break older apps.
public enum APIErrorCode: Equatable, Sendable, Decodable {
    case malformedJSON, unauthenticated, forbidden, notFound, methodNotAllowed
    case conflict, pogChanged, validationFailed, pogNotAssigned, unresolvedCounts
    case rateLimited, internalError, notImplemented, dependencyUnavailable, configurationInvalid
    case unknown(String)

    private static let byRawValue: [String: APIErrorCode] = [
        "MALFORMED_JSON": .malformedJSON, "UNAUTHENTICATED": .unauthenticated, "FORBIDDEN": .forbidden,
        "NOT_FOUND": .notFound, "METHOD_NOT_ALLOWED": .methodNotAllowed, "CONFLICT": .conflict,
        "POG_CHANGED": .pogChanged, "VALIDATION_FAILED": .validationFailed, "POG_NOT_ASSIGNED": .pogNotAssigned,
        "UNRESOLVED_COUNTS": .unresolvedCounts, "RATE_LIMITED": .rateLimited, "INTERNAL_ERROR": .internalError,
        "NOT_IMPLEMENTED": .notImplemented, "DEPENDENCY_UNAVAILABLE": .dependencyUnavailable,
        "CONFIGURATION_INVALID": .configurationInvalid,
    ]

    public init(rawValue: String) {
        self = Self.byRawValue[rawValue] ?? .unknown(rawValue)
    }

    public init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }
}

/// `GET /api/v1/health` payload.
public struct HealthStatus: Decodable, Sendable, Equatable {
    public struct Checks: Decodable, Sendable, Equatable {
        public let configuration: String
        public let database: String
        public let authentication: String
        public let jobQueue: String

        enum CodingKeys: String, CodingKey {
            case configuration, database, authentication
            case jobQueue = "job_queue"
        }
    }

    public let status: String
    public let service: String
    public let apiVersion: String
    public let checkedAt: Date
    public let checks: Checks

    enum CodingKeys: String, CodingKey {
        case status, service, checks
        case apiVersion = "api_version"
        case checkedAt = "checked_at"
    }
}
