import Foundation
import Security

/// Persistence for the signed-in session. The live app uses the Keychain;
/// tests and previews use memory. Nothing else (UserDefaults, files) may hold
/// tokens.
public protocol SessionStore: Sendable {
    func load() throws(SessionStoreError) -> AuthSession?
    func save(_ session: AuthSession) throws(SessionStoreError)
    func delete() throws(SessionStoreError)
}

public enum SessionStoreError: Error, Equatable, Sendable {
    case keychain(OSStatus)
    case corrupted
}

/// Keychain generic-password item, readable only on this device after the
/// first unlock (background refresh keeps working; no iCloud/backup sync).
public struct KeychainSessionStore: SessionStore {
    private let service: String
    private let account: String

    public init(service: String = "com.displayrefill.app.session", account: String = "supabase-auth") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        #if os(iOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        return query
    }

    public func load() throws(SessionStoreError) -> AuthSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw .keychain(status) }
        do {
            return try JSONCoding.makeDecoder().decode(AuthSession.self, from: data)
        } catch {
            // Unreadable item: remove it so the user can sign in again.
            try? delete()
            throw .corrupted
        }
    }

    public func save(_ session: AuthSession) throws(SessionStoreError) {
        let data: Data
        do {
            data = try JSONCoding.makeEncoder().encode(session)
        } catch {
            throw .corrupted
        }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let add = baseQuery.merging(attributes) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw .keychain(status) }
    }

    public func delete() throws(SessionStoreError) {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .keychain(status) }
    }
}

/// In-memory store for tests and previews.
public final class InMemorySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: AuthSession?

    public init(_ session: AuthSession? = nil) {
        self.session = session
    }

    public func load() throws(SessionStoreError) -> AuthSession? {
        lock.withLock { session }
    }

    public func save(_ session: AuthSession) throws(SessionStoreError) {
        lock.withLock { self.session = session }
    }

    public func delete() throws(SessionStoreError) {
        lock.withLock { session = nil }
    }
}
