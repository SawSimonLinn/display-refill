import Foundation

/// A Supabase Auth session as the app persists it (Keychain only).
public struct AuthSession: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let userID: UUID
    public let email: String?

    public init(accessToken: String, refreshToken: String, expiresAt: Date, userID: UUID, email: String?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userID = userID
        self.email = email
    }

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
        case userID = "user_id"
        case email
    }
}

/// Sign-in and session failures, without credentials or server text.
public enum AuthError: Error, Equatable, Sendable {
    /// Wrong email or password (the server does not say which).
    case invalidCredentials
    /// No session, or Supabase Auth rejected the refresh token: sign in again.
    case sessionExpired
    case rateLimited
    case transport(URLError.Code)
    case unexpected(status: Int)
}

// MARK: - GET /api/v1/me

public enum OrganizationRole: Equatable, Sendable, Decodable {
    case member, admin
    case unknown(String)

    public init(from decoder: Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "member": self = .member
        case "admin": self = .admin
        case let other: self = .unknown(other)
        }
    }
}

/// Effective role in a store. Unknown future roles decode without failing
/// and grant nothing in the app.
public enum StoreAccessRole: Equatable, Sendable, Decodable {
    case employee, manager, admin
    case unknown(String)

    public init(from decoder: Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "employee": self = .employee
        case "manager": self = .manager
        case "admin": self = .admin
        case let other: self = .unknown(other)
        }
    }

    public var label: String {
        switch self {
        case .employee: "Employee"
        case .manager: "Manager"
        case .admin: "Admin"
        case .unknown: "Member"
        }
    }
}

public struct Me: Decodable, Sendable, Equatable {
    public struct Organization: Decodable, Sendable, Equatable {
        public let organizationID: UUID
        public let name: String
        public let role: OrganizationRole

        enum CodingKeys: String, CodingKey {
            case name, role
            case organizationID = "organization_id"
        }
    }

    public struct Store: Decodable, Sendable, Equatable, Identifiable {
        public let storeID: UUID
        public let organizationID: UUID
        public let name: String
        public let storeNumber: String
        public let timezone: String
        public let role: StoreAccessRole

        public var id: UUID { storeID }

        enum CodingKeys: String, CodingKey {
            case name, timezone, role
            case storeID = "store_id"
            case organizationID = "organization_id"
            case storeNumber = "store_number"
        }
    }

    public struct Capabilities: Decodable, Sendable, Equatable {
        public let dashboard: Bool
        public let adminOrganizationIDs: [UUID]

        enum CodingKeys: String, CodingKey {
            case dashboard
            case adminOrganizationIDs = "admin_organization_ids"
        }
    }

    public let userID: UUID
    public let email: String?
    public let displayName: String
    public let organizations: [Organization]
    public let stores: [Store]
    public let capabilities: Capabilities

    enum CodingKeys: String, CodingKey {
        case email, organizations, stores, capabilities
        case userID = "user_id"
        case displayName = "display_name"
    }
}

/// `POST /api/v1/auth/password-reset` acknowledgement (same for every email).
public struct PasswordResetAck: Decodable, Sendable, Equatable {
    public let status: String

    public init(status: String) {
        self.status = status
    }
}
