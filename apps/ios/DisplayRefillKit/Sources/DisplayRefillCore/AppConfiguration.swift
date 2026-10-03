import Foundation

/// Public configuration the app is allowed to hold. Only the API base URL,
/// the Supabase project URL and the publishable key — never a service-role
/// key, database URL or provider key.
public struct AppConfiguration: Equatable, Sendable {
    public let apiBaseURL: URL
    public let supabaseURL: URL
    public let supabasePublishableKey: String

    public enum Key: String, CaseIterable, Sendable {
        case apiBaseURL = "API_BASE_URL"
        case supabaseURL = "SUPABASE_URL"
        case supabasePublishableKey = "SUPABASE_PUBLISHABLE_KEY"
    }

    /// Keys that must never appear in the app's Info.plist.
    public static let forbiddenKeys: [String] = [
        "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "VISION_API_KEY",
    ]

    public init(apiBaseURL: URL, supabaseURL: URL, supabasePublishableKey: String) {
        self.apiBaseURL = apiBaseURL
        self.supabaseURL = supabaseURL
        self.supabasePublishableKey = supabasePublishableKey
    }

    /// Non-throwing form for app startup, so the UI can show what is missing.
    public static func load(infoDictionary: [String: Any]) -> Result<AppConfiguration, ConfigurationError> {
        do throws(ConfigurationError) {
            return .success(try AppConfiguration(infoDictionary: infoDictionary))
        } catch {
            return .failure(error)
        }
    }

    /// Reads and validates configuration from an Info.plist dictionary.
    /// Errors name the key and the rule, never the value.
    public init(infoDictionary: [String: Any]) throws(ConfigurationError) {
        var problems: [ConfigurationError.Problem] = []

        for key in Self.forbiddenKeys where infoDictionary[key] != nil {
            problems.append(.init(key: key, problem: "must not be bundled in the app"))
        }

        func string(_ key: Key) -> String? {
            let raw = (infoDictionary[key.rawValue] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            // An unexpanded "$(VAR)" means the xcconfig did not define it.
            if raw.isEmpty || raw.hasPrefix("$(") {
                problems.append(.init(key: key.rawValue, problem: "is required (set it in Config/Local.xcconfig)"))
                return nil
            }
            return raw
        }

        func httpURL(_ key: Key) -> URL? {
            guard let raw = string(key) else { return nil }
            guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil else {
                problems.append(.init(key: key.rawValue, problem: "must be an http:// or https:// URL"))
                return nil
            }
            return url
        }

        let api = httpURL(.apiBaseURL)
        let supabase = httpURL(.supabaseURL)
        let key = string(.supabasePublishableKey)
        if let key, SupabaseKeyInspector.looksLikeSecretKey(key) {
            problems.append(.init(key: Key.supabasePublishableKey.rawValue, problem: "must be the publishable key; a secret/service-role key was supplied"))
        }

        guard problems.isEmpty, let api, let supabase, let key else {
            throw ConfigurationError(problems: problems)
        }
        self.init(apiBaseURL: api, supabaseURL: supabase, supabasePublishableKey: key)
    }
}

public struct ConfigurationError: Error, Equatable, Sendable, CustomStringConvertible {
    public struct Problem: Equatable, Sendable {
        public let key: String
        public let problem: String

        public init(key: String, problem: String) {
            self.key = key
            self.problem = problem
        }
    }

    public let problems: [Problem]

    public init(problems: [Problem]) {
        self.problems = problems
    }

    public var description: String {
        (["Invalid app configuration:"] + problems.map { "- \($0.key): \($0.problem)" }).joined(separator: "\n")
    }
}

/// Mirrors `looksLikeSupabaseSecretKey` in packages/domain.
public enum SupabaseKeyInspector {
    public static func looksLikeSecretKey(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("sb_secret_") { return true }
        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return false }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return payload["role"] as? String == "service_role"
    }
}
