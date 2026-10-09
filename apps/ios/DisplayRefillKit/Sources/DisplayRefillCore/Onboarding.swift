import Foundation

// Feature 16: self-service sign-up, organization access code, create-or-join store and the
// store's display case types. The server decides every role; the app only shows the steps.

/// Where a signed-in account is in onboarding (`GET /api/v1/onboarding`).
public struct OnboardingStatus: Decodable, Sendable, Equatable {
    public enum State: Equatable, Sendable, Decodable {
        /// New account: enter the organization's access code.
        case accessCode
        /// Only revoked memberships; the code cannot restore them.
        case removed
        /// Member without a store: create or join one by number.
        case store
        case complete
        case unknown(String)

        public init(from decoder: any Decoder) throws {
            switch try decoder.singleValueContainer().decode(String.self) {
            case "access_code": self = .accessCode
            case "removed": self = .removed
            case "store": self = .store
            case "complete": self = .complete
            case let other: self = .unknown(other)
            }
        }
    }

    public struct Organization: Decodable, Sendable, Equatable {
        public let organization_id: String
        public let name: String
        public let role: String
    }

    public let state: State
    public let organization: Organization?

    public init(state: State, organization: Organization? = nil) { self.state = state; self.organization = organization }
}

/// Result of `POST /onboarding/store`: the store and the caller's role in it.
public struct StoreJoinResult: Decodable, Sendable, Equatable {
    public struct Store: Decodable, Sendable, Equatable {
        public let store_id: String
        public let name: String
        public let store_number: String
        public let timezone: String
    }
    public let created: Bool
    public let role: String
    public let store: Store
}

/// A display case type the store can choose (`sections` of the production config).
public struct DisplayCaseChoice: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let code: String
    public let name: String
    public let selected: Bool
    /// Fruit, Vegetables, Salads or Other; groups the choices on screen.
    public let family: String
    public init(id: String, code: String, name: String, selected: Bool, family: String = "Other") {
        self.id = id; self.code = code; self.name = name; self.selected = selected; self.family = family
    }
    private enum CodingKeys: String, CodingKey { case id, code, name, selected, family }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        code = try c.decode(String.self, forKey: .code)
        name = try c.decode(String.self, forKey: .name)
        selected = try c.decode(Bool.self, forKey: .selected)
        family = try c.decodeIfPresent(String.self, forKey: .family) ?? "Other"
    }
}

extension StoreDisplayCases {
    /// Choices grouped by family in a fixed order (Fruit, Vegetables, Salads, then the rest),
    /// keeping the server's order inside each group. "Other" holds the fruit-and-veg combos.
    public var groups: [(family: String, choices: [DisplayCaseChoice])] {
        Self.grouped(sections)
    }

    public static func grouped(_ choices: [DisplayCaseChoice]) -> [(family: String, choices: [DisplayCaseChoice])] {
        let order = ["Fruit", "Vegetables", "Salads"]
        let families = order.filter { f in choices.contains { $0.family == f } }
            + choices.map(\.family).filter { !order.contains($0) }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        return families.map { f in (f, choices.filter { $0.family == f }) }
    }
}

public struct StoreDisplayCases: Decodable, Sendable, Equatable {
    public let can_manage: Bool
    public let sections: [DisplayCaseChoice]
    public init(can_manage: Bool, sections: [DisplayCaseChoice]) { self.can_manage = can_manage; self.sections = sections }
}

/// Store managers also edit the store's PAR from the same screens.
public protocol OnboardingAPI: StorePARAPI {
    func onboardingStatus() async throws(APIClientError) -> OnboardingStatus
    func joinOrganization(accessCode: String) async throws(APIClientError) -> OnboardingStatus
    /// `name`/`timezone` are needed only when the number is new (the caller then becomes manager).
    func joinStore(number: String, name: String?, timezone: String?) async throws(APIClientError) -> StoreJoinResult
    func storeDisplayCases(storeID: String) async throws(APIClientError) -> StoreDisplayCases
    func setStoreDisplayCases(storeID: String, typeIDs: [String]) async throws(APIClientError) -> StoreDisplayCases
}

extension URLSessionAccountAPI: OnboardingAPI {
    public func onboardingStatus() async throws(APIClientError) -> OnboardingStatus {
        try await authorizedRequest("api/v1/onboarding")
    }
    public func joinOrganization(accessCode: String) async throws(APIClientError) -> OnboardingStatus {
        try await authorizedRequest("api/v1/onboarding/join", method: "POST", body: Self.json(["access_code": accessCode]))
    }
    public func joinStore(number: String, name: String?, timezone: String?) async throws(APIClientError) -> StoreJoinResult {
        var body = ["store_number": number]
        if let name { body["name"] = name }
        if let timezone { body["timezone"] = timezone }
        return try await authorizedRequest("api/v1/onboarding/store", method: "POST", body: Self.json(body))
    }
    public func storeDisplayCases(storeID: String) async throws(APIClientError) -> StoreDisplayCases {
        try await authorizedRequest("api/v1/production/\(storeID)?view=config")
    }
    public func setStoreDisplayCases(storeID: String, typeIDs: [String]) async throws(APIClientError) -> StoreDisplayCases {
        try await authorizedRequest("api/v1/stores/\(storeID)/display-types", method: "PUT", body: Self.json(["display_type_ids": typeIDs]))
    }
    private static func json(_ value: some Encodable) -> Data? { try? JSONEncoder().encode(value) }
}

/// Organization access codes: 8 letters or digits, shown as `XXXX-XXXX` (the server
/// ignores the dash and case).
public enum AccessCode {
    public static let length = 8

    /// Letters and digits only, uppercased, at most 8. Dashes, spaces and symbols are dropped.
    public static func characters(_ input: String) -> String {
        String(input.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(length))
    }

    /// What the field shows while typing: the dash appears once a 5th character is entered.
    public static func formatted(_ input: String) -> String {
        let chars = characters(input)
        guard chars.count > 4 else { return chars }
        return chars.prefix(4) + "-" + chars.dropFirst(4)
    }

    public static func isComplete(_ input: String) -> Bool { characters(input).count == length }
}

/// Public email sign-up with a 6-digit confirmation code (no email link).
public protocol SignUpAPI: Sendable {
    /// Creates the account and emails a code. Supabase answers the same way for an email that is
    /// already registered, so the app never learns (or shows) whether an account exists.
    func signUp(email: String, password: String, displayName: String) async throws(AuthError)
    func verifySignUpCode(email: String, code: String) async throws(AuthError) -> AuthSession
    func resendSignUpCode(email: String) async throws(AuthError)
}

extension SupabaseAuthClient: SignUpAPI {
    public func signUp(email: String, password: String, displayName: String) async throws(AuthError) {
        let body: [String: Any] = ["email": email, "password": password, "data": ["display_name": displayName]]
        let (data, response) = try await postJSON("auth/v1/signup", body: body)
        switch response.statusCode {
        case 200..<300: return
        case 429: throw .rateLimited
        case 400, 422: throw Self.errorCode(data) == "weak_password" ? .weakPassword : .signUpRejected
        default: throw .unexpected(status: response.statusCode)
        }
    }

    public func verifySignUpCode(email: String, code: String) async throws(AuthError) -> AuthSession {
        let (data, response) = try await postJSON("auth/v1/verify", body: ["type": "email", "email": email, "token": code])
        switch response.statusCode {
        case 200: return try decodeSession(data)
        case 429: throw .rateLimited
        case 400, 401, 403, 404, 422: throw .invalidCode
        default: throw .unexpected(status: response.statusCode)
        }
    }

    public func resendSignUpCode(email: String) async throws(AuthError) {
        let (_, response) = try await postJSON("auth/v1/resend", body: ["type": "signup", "email": email])
        switch response.statusCode {
        case 200..<300: return
        case 429: throw .rateLimited
        default: throw .unexpected(status: response.statusCode)
        }
    }

    private static func errorCode(_ data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any]).flatMap { ($0["error_code"] ?? $0["code"]) as? String }
    }
}
