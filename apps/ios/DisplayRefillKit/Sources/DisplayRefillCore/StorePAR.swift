import Foundation
import Observation

// Store PAR on mobile: managers change how many of each product a display case should hold
// at their store. Items from a display case type keep following the admin's default PAR
// until the store sets its own; saving the default again clears the override.

/// One product in one of the store's display cases (`items` of the production config).
/// PAR fields are present only for managers.
public struct StorePARItem: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let product_id: String
    public let product_name: String
    public let section: String
    public let category: String
    public let product_type: String
    public let sort_order: Int
    public let active: Bool
    public let revision: Int
    public let par: Int?
    public let from_display_type: Bool?
    public let par_overridden: Bool?
    public let default_par: Int?

    public init(id: String, product_id: String, product_name: String, section: String, category: String = "", product_type: String = "",
                sort_order: Int = 0, active: Bool = true, revision: Int = 1, par: Int?, from_display_type: Bool? = nil,
                par_overridden: Bool? = nil, default_par: Int? = nil) {
        self.id = id; self.product_id = product_id; self.product_name = product_name; self.section = section
        self.category = category; self.product_type = product_type; self.sort_order = sort_order; self.active = active
        self.revision = revision; self.par = par; self.from_display_type = from_display_type
        self.par_overridden = par_overridden; self.default_par = default_par
    }

    /// The store set its own PAR and the display case type has a default to go back to.
    public var canReset: Bool { par_overridden == true && default_par != nil }

    /// A `configure` request that changes only PAR; every other field is sent back as it is
    /// because the server replaces them all.
    public func setting(par: Int) -> StorePARMutation {
        StorePARMutation(item_id: id, product_id: product_id, section: section, par: par, category: category,
                         product_type: product_type, sort_order: sort_order, active: active, expected_revision: revision)
    }
}

public struct StorePARMutation: Codable, Sendable, Hashable {
    public var action = "configure"
    public let item_id: String
    public let product_id: String
    public let section: String
    public let par: Int
    public let category: String
    public let product_type: String
    public let sort_order: Int
    public let active: Bool
    public let expected_revision: Int
}

/// `GET /production/{store}?view=config`, also returned by `configure`.
public struct StorePARConfig: Decodable, Sendable, Equatable {
    public let can_manage: Bool
    public let sections: [DisplayCaseChoice]
    public let items: [StorePARItem]

    public init(can_manage: Bool, sections: [DisplayCaseChoice], items: [StorePARItem]) {
        self.can_manage = can_manage; self.sections = sections; self.items = items
    }

    /// Active items by display case, in the organization's type order; sections the config no
    /// longer lists (an archived type) come last under their code.
    public var groups: [(code: String, name: String, items: [StorePARItem])] {
        let active = items.filter(\.active)
        let known = sections.map(\.code).filter { code in active.contains { $0.section == code } }
        let rest = active.map(\.section).filter { !known.contains($0) }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        return (known + rest).map { code in
            (code, sections.first { $0.code == code }?.name ?? code,
             active.filter { $0.section == code }.sorted { ($0.sort_order, $0.product_name) < ($1.sort_order, $1.product_name) })
        }
    }
}

public protocol StorePARAPI: Sendable {
    func storePAR(storeID: String) async throws(APIClientError) -> StorePARConfig
    func setStorePAR(storeID: String, mutation: StorePARMutation, key: String) async throws(APIClientError) -> StorePARConfig
}

extension URLSessionAccountAPI: StorePARAPI {
    public func storePAR(storeID: String) async throws(APIClientError) -> StorePARConfig {
        try await authorizedRequest("api/v1/production/\(storeID)?view=config")
    }
    public func setStorePAR(storeID: String, mutation: StorePARMutation, key: String) async throws(APIClientError) -> StorePARConfig {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try await authorizedRequest("api/v1/production/\(storeID)", method: "POST", body: try? encoder.encode(mutation), key: key)
    }
}

/// Loads the store's PAR and saves one item at a time. A save that may not have reached the
/// server keeps its idempotency key, so retrying the same value cannot apply it twice.
@MainActor @Observable public final class StorePARModel {
    public private(set) var config: StorePARConfig?
    public var inputs: [String: String] = [:]
    public private(set) var loading = false
    /// The item being saved.
    public private(set) var saving: String?
    public private(set) var savedItem: String?
    public private(set) var error: String?

    private let api: any StorePARAPI
    public let storeID: String
    private var pendingKeys: [StorePARMutation: String] = [:]

    public init(api: any StorePARAPI, storeID: String) { self.api = api; self.storeID = storeID }

    public func load() async {
        loading = true; error = nil
        defer { loading = false }
        do throws(APIClientError) { apply(try await api.storePAR(storeID: storeID)) }
        catch { self.error = Self.message(error) }
    }

    /// The typed PAR when it is a whole number 0–9999 that differs from the saved one.
    public func changedPAR(_ item: StorePARItem) -> Int? {
        guard let text = inputs[item.id]?.trimmingCharacters(in: .whitespaces), let value = Int(text),
              (0...9999).contains(value), value != item.par else { return nil }
        return value
    }

    public func isInvalid(_ item: StorePARItem) -> Bool {
        guard let text = inputs[item.id]?.trimmingCharacters(in: .whitespaces), !text.isEmpty else { return true }
        guard let value = Int(text) else { return true }
        return !(0...9999).contains(value)
    }

    public func save(_ item: StorePARItem) async {
        guard let value = changedPAR(item) else { return }
        await send(item.setting(par: value))
    }

    /// Goes back to the display case type's default PAR (clears the store override).
    public func reset(_ item: StorePARItem) async {
        guard item.canReset, let value = item.default_par else { return }
        inputs[item.id] = String(value)
        await send(item.setting(par: value))
    }

    private func send(_ mutation: StorePARMutation) async {
        guard saving == nil else { return }
        let key = pendingKeys[mutation] ?? UUID().uuidString.lowercased()
        pendingKeys[mutation] = key
        saving = mutation.item_id; savedItem = nil; error = nil
        defer { saving = nil }
        do throws(APIClientError) {
            let next = try await api.setStorePAR(storeID: storeID, mutation: mutation, key: key)
            pendingKeys[mutation] = nil
            apply(next, keepingInputsExcept: mutation.item_id)
            savedItem = mutation.item_id
        } catch {
            if case .transport = error {} else { pendingKeys[mutation] = nil }
            if case .server(_, .conflict, _, _) = error {
                // Someone else changed this item: show the current values before trying again.
                await reload(keepingInputsExcept: mutation.item_id)
                self.error = "Someone else just changed this PAR. Check the new value and save again."
            } else {
                self.error = Self.message(error)
            }
        }
    }

    private func reload(keepingInputsExcept id: String) async {
        if let next = try? await api.storePAR(storeID: storeID) { apply(next, keepingInputsExcept: id) }
    }

    /// Unsaved edits on other rows survive a refresh; the saved row shows the server's value.
    private func apply(_ next: StorePARConfig, keepingInputsExcept id: String? = nil) {
        let old = config?.items ?? []
        var fresh: [String: String] = [:]
        for item in next.items {
            let before = old.first { $0.id == item.id }
            let edited = item.id != id && before != nil && inputs[item.id] != before?.par.map(String.init)
            fresh[item.id] = edited ? inputs[item.id] : item.par.map(String.init) ?? ""
        }
        config = next; inputs = fresh
    }

    static func message(_ error: APIClientError) -> String {
        switch error {
        case .server(_, .validationFailed, let message, _):
            return message == "The request contains invalid values." ? "Enter a PAR from 0 to 9999." : message
        case .server(_, .forbidden, _, _): return "Only the store's manager can change PAR."
        case .server(_, .notFound, _, _): return "This item was removed. Pull to refresh."
        case .server(_, .rateLimited, _, _): return "Too many changes at once. Wait a moment and try again."
        case .transport: return "Can't reach the server. Check your connection and save again."
        case .signedOut: return "Your session ended. Sign in again."
        default: return "Couldn't save PAR. Try again shortly."
        }
    }
}
