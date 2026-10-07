import Foundation
import Observation

public enum ProductionSection: String, Codable, Sendable, CaseIterable, Identifiable {
    case fruitMobile = "fruit_mobile", saladMobile = "salad_mobile", fruitCase = "fruit_case", veggieCase = "veggie_case"
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .fruitMobile: "M1 BUNKER (FRUIT)"
        case .saladMobile: "SALAD DESTINATION"
        case .fruitCase: "6FT FRUIT"
        case .veggieCase: "Veggie display case"
        }
    }
}
public struct ProductionItem: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let product_id: String
    public let product_name: String
    public let category: String
    public let product_type: String
    public let have: Int?
    public let make: Int?
    public let backup: Int?
    public let backup_required: Bool?
    public let shared_size: Int?
    public init(id: String, product_id: String, product_name: String, category: String, product_type: String, have: Int?, make: Int?, backup: Int? = nil, backup_required: Bool? = nil, shared_size: Int? = nil) {
        self.id = id; self.product_id = product_id; self.product_name = product_name; self.category = category; self.product_type = product_type; self.have = have; self.make = make; self.backup = backup; self.backup_required = backup_required; self.shared_size = shared_size
    }
}
public struct ProductionCheck: Decodable, Sendable {
    public let id: String
    public let section: ProductionSection
    public let revision: Int
    public let status: String
    public let items: [ProductionItem]
    public let total_make: Int?
}
public struct ProductionDay: Decodable, Sendable {
    public struct Section: Decodable, Sendable, Identifiable {
        public var id: String { section.rawValue }
        public let section: ProductionSection
        public let check_id: String?
        public let finished_at: String?
        public let in_progress: Bool?
        public let items: [ProductionItem]
        public let total_make: Int?
    }
    public let date: String
    public let sections: [Section]
    public let total_make: Int
    public let complete: Bool
}
public struct ProductionMutation: Encodable, Sendable {
    public struct Count: Encodable, Sendable {
        public let id: String
        public let have: Int?
        public let backup: Int?
        public let includesBackup: Bool
        public init(id: String, have: Int?, backup: Int? = nil, includesBackup: Bool = false) { self.id = id; self.have = have; self.backup = backup; self.includesBackup = includesBackup }
        enum CodingKeys: CodingKey { case id, have, backup }
        public func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(id, forKey: .id)
            if let have { try c.encode(have, forKey: .have) } else { try c.encodeNil(forKey: .have) }
            if includesBackup { if let backup { try c.encode(backup, forKey: .backup) } else { try c.encodeNil(forKey: .backup) } }
        }
    }
    let action: String
    let section: ProductionSection?
    let check_id: String?
    let expected_revision: Int?
    let items: [Count]?
}
public protocol ProductionAPI: Sendable {
    func productionDay(storeID: String) async throws -> ProductionDay
    func productionCheck(storeID: String, checkID: String) async throws -> ProductionCheck
    func productionMutate(storeID: String, mutation: ProductionMutation, key: String) async throws -> ProductionCheck
}
extension URLSessionAccountAPI: ProductionAPI {
    public func productionDay(storeID: String) async throws -> ProductionDay {
        try await authorizedRequest("api/v1/production/\(storeID)?view=day")
    }
    public func productionCheck(storeID: String, checkID: String) async throws -> ProductionCheck {
        try await authorizedRequest("api/v1/production/\(storeID)?view=check&check_id=\(checkID)")
    }
    public func productionMutate(storeID: String, mutation: ProductionMutation, key: String) async throws -> ProductionCheck {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try await authorizedRequest("api/v1/production/\(storeID)", method: "POST", body: encoder.encode(mutation), key: key)
    }
}

/// Serializes writes and retains the exact request/key after uncertain transport failures.
/// Local edits made during a request are never replaced by that request's response.
@MainActor @Observable public final class ProductionWorksheet {
    public private(set) var day: ProductionDay?
    public private(set) var check: ProductionCheck?
    public private(set) var input: [String: String] = [:]
    public private(set) var busy = false
    public private(set) var error: String?
    public private(set) var conflict = false
    public private(set) var pending = false
    private let api: any ProductionAPI
    public let storeID: String
    private var dirty: Set<String> = []
    private var debounce: Task<Void, Never>?
    private struct Operation {
        let mutation: ProductionMutation
        let key: String
        let values: [String: String]
    }
    private var operation: Operation?
    public init(api: any ProductionAPI, storeID: String) { self.api = api; self.storeID = storeID }
    public static func valid(_ text: String) -> Bool { text.isEmpty || (text.allSatisfy { $0.isASCII && $0.isNumber } && Int(text).map { (0...9999).contains($0) } == true) }
    /// Blank counts are allowed; finish() records them as 0.
    public var canFinish: Bool { check?.status == "draft" && check?.items.allSatisfy { Self.valid(input[$0.id] ?? "") } == true && !busy && !conflict }
    public var saved: Bool { !pending && !busy && error == nil }
    public func load() async {
        do { day = try await api.productionDay(storeID: storeID) }
        catch { self.error = Self.message(error) }
    }
    public func start(_ section: ProductionSection) async {
        guard !busy, !pending, !conflict else { return }
        if operation == nil {
            operation = Operation(mutation: .init(action: "start", section: section, check_id: nil, expected_revision: nil, items: nil), key: UUID().uuidString, values: [:])
        }
        await send()
    }
    public func edit(_ id: String, text: String) {
        guard check?.status == "draft" else { return }
        input[id] = text; dirty.insert(id); pending = true
        debounce?.cancel()
        debounce = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            guard let self else { return }
            // Do not tie the network request to a debounce that a later keystroke cancels.
            Task { await self.save() }
        }
    }
    public func save() async {
        guard !busy, !conflict else { return }
        if operation != nil { await send(); return }
        guard let check, check.status == "draft", !dirty.isEmpty else { return }
        guard dirty.allSatisfy({ Self.valid(input[$0] ?? "") }) else { error = "Enter a whole number from 0 to 9999, or leave blank."; return }
        let values = Dictionary(uniqueKeysWithValues: dirty.map { ($0, input[$0] ?? "") })
        operation = Operation(mutation: .init(action: "counts", section: nil, check_id: check.id, expected_revision: check.revision, items: check.items.filter { values[$0.id] != nil || values[$0.id + ":backup"] != nil }.map { .init(id: $0.id, have: Int(input[$0.id] ?? ""), backup: $0.backup_required == true ? 0 : nil, includesBackup: $0.backup_required == true) }), key: UUID().uuidString, values: values)
        await send()
    }
    public func finish() async {
        guard canFinish, let items = check?.items else { return }
        for item in items where (input[item.id] ?? "").isEmpty { input[item.id] = "0"; dirty.insert(item.id); pending = true }
        debounce?.cancel()
        await save()
        guard saved, canFinish, let check else { return }
        operation = Operation(mutation: .init(action: "finish", section: nil, check_id: check.id, expected_revision: check.revision, items: nil), key: UUID().uuidString, values: [:])
        await send()
        if self.check?.status == "finished" { await load() }
    }
    public func restartCount() async {
        guard !busy, (operation == nil || conflict), let check, check.status == "draft" else { return }
        debounce?.cancel(); conflict = false; pending = true
        operation = Operation(mutation: .init(action: "restart", section: nil, check_id: check.id, expected_revision: check.revision, items: nil), key: UUID().uuidString, values: [:])
        await send()
    }
    public func retry() async { if operation != nil { await send() } else { await save() }; if check?.status != "draft" { await load() } }
    public func clearError() { error = nil }
    /// Explicit conflict acknowledgement fetches the new revision, retaining unsaved fields.
    public func reloadConflict() async {
        guard !busy, let check else { return }
        busy = true
        do {
            let fresh = try await api.productionCheck(storeID: storeID, checkID: check.id)
            self.check = fresh
            syncInputs(fresh.items)
            operation = nil; conflict = false
            error = fresh.status == "finished" ? "This section was finished elsewhere. Your unsaved entries are retained here; start a new check to change counts." : "Latest saved counts loaded. Your edits are kept. Review them, then tap Save my edits."
        } catch { self.error = Self.message(error) }
        busy = false
    }
    public func discardLocalEdits() {
        guard !busy else { return }
        debounce?.cancel(); operation = nil; dirty = []; pending = false; conflict = false; error = nil
        syncInputs(check?.items ?? [])
    }
    public func discardFinishedEdits() {
        guard !busy, check?.status == "finished" else { return }
        dirty = []; pending = false; conflict = false; operation = nil; check = nil; input = [:]; error = nil
    }
    public func returnToSections() { guard !busy, !pending else { return }; check = nil; input = [:]; error = nil }
    private func syncInputs(_ items: [ProductionItem]) {
        for item in items {
            if !dirty.contains(item.id) { input[item.id] = item.have.map(String.init) ?? "" }
            if !dirty.contains(item.id + ":backup") { input[item.id + ":backup"] = item.backup.map(String.init) ?? "" }
        }
    }
    private func send() async {
        guard !busy, !conflict, let op = operation else { return }
        busy = true; error = nil
        do {
            let result = try await api.productionMutate(storeID: storeID, mutation: op.mutation, key: op.key)
            if op.mutation.action == "restart" { dirty = []; input = [:] }
            check = result
            for (id, sent) in op.values where input[id] == sent { dirty.remove(id) }
            syncInputs(result.items)
            operation = nil; pending = !dirty.isEmpty
        } catch {
            self.error = Self.message(error)
            if case .server(409, _, _, _) = error as? APIClientError { conflict = true }
            else if case .server(422, .validationFailed, _, _) = error as? APIClientError {
                // Keep the open count; the message says what to fix.
                operation = nil; dirty = []; pending = false
                syncInputs(check?.items ?? [])
            } else if case .server(let status, _, _, _) = error as? APIClientError, (400..<500).contains(status), status != 429 {
                operation = nil; pending = false
            }
        }
        busy = false
        if error == nil, !dirty.isEmpty { await save() }
    }
    private static func message(_ error: any Error) -> String {
        guard let apiError = error as? APIClientError else { return HistoryFailure.message(error) }
        switch apiError {
        case .server(422, .validationFailed, let message, _):
            return ["The request contains invalid values.", "Invalid worksheet input."].contains(message)
                ? "That count could not be saved. Check the numbers and try again."
                : message
        case .server(409, .conflict, _, _):
            return "This section changed on another device. Reload the latest counts, then save again."
        case .server(_, _, let message, _):
            return message
        case .transport:
            return "Can't reach the server. Check your connection and try again."
        default:
            return HistoryFailure.message(apiError)
        }
    }
}
