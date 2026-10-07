import Foundation
import Observation
public struct StockMutation: Codable, Sendable {
    public struct Count: Codable, Sendable { public let section: ProductionSection; public let have: Int; public let backup: Int? }
    public let product_id: String
    public let expected_revision: String
    public let counts: [Count]
}
public protocol StockUpdateAPI: Sendable {
    func updateStock(storeID: String, mutation: StockMutation, key: String) async throws -> PrepBoard
}
extension URLSessionAccountAPI: StockUpdateAPI {
    public func updateStock(storeID: String, mutation: StockMutation, key: String) async throws -> PrepBoard {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try await authorizedRequest("api/v1/stock/\(storeID)", method: "POST", body: encoder.encode(mutation), key: key)
    }
}
@MainActor @Observable public final class StockUpdateModel {
    public var inputs: [String: String] = [:]
    public private(set) var busy = false
    public private(set) var pending = false
    public private(set) var conflict = false
    public private(set) var saved = false
    public private(set) var error: String?
    private let api: any StockUpdateAPI
    private let storeID: String
    private let persistenceKey: String?
    private struct Operation: Codable { let mutation: StockMutation; let key: String }
    private var operation: Operation?
    public init(api: any StockUpdateAPI, storeID: String, persistenceKey: String? = nil) {
        self.api = api; self.storeID = storeID; self.persistenceKey = persistenceKey
        if let persistenceKey, let data = UserDefaults.standard.data(forKey: persistenceKey), let op = try? JSONDecoder().decode(Operation.self, from: data) {
            operation = op; pending = true
            for count in op.mutation.counts { inputs[count.section.rawValue] = String(count.have); if let backup = count.backup { inputs[count.section.rawValue + ":backup"] = String(backup) } }
            error = "Retry the interrupted stock save before entering a different count."
        }
    }
    /// Seed last observed counts without replacing edits or an interrupted operation.
    public func loadCounts(_ item: PrepItem) {
        guard !pending, operation == nil else { return }
        for location in item.locations where inputs[location.section.rawValue] == nil {
            if let have = location.have { inputs[location.section.rawValue] = String(have) }
        }
    }
    public func save(_ item: PrepItem) async {
        guard !busy, !conflict else { return }
        if operation == nil {
            let keys = item.locations.map { $0.section.rawValue }
            guard !keys.isEmpty, keys.allSatisfy({ !(inputs[$0] ?? "").isEmpty && ProductionWorksheet.valid(inputs[$0] ?? "") }) else { error = "Enter each count. Use 0 when none are available."; return }
            let counts = item.locations.map { StockMutation.Count(section: $0.section, have: Int(inputs[$0.section.rawValue] ?? "") ?? 0, backup: $0.backup_required == true ? 0 : nil) }
            operation = .init(mutation: .init(product_id: item.id, expected_revision: item.revision, counts: counts), key: UUID().uuidString)
            pending = true; persist()
        }
        guard let op = operation else { return }
        busy = true; error = nil
        do {
            _ = try await api.updateStock(storeID: storeID, mutation: op.mutation, key: op.key)
            operation = nil; pending = false; saved = true; persist()
        } catch {
            self.error = Self.message(error)
            if case .server(let status, _, _, _) = error as? APIClientError, (400..<500).contains(status), status != 429 {
                operation = nil; pending = false; persist()
                if status == 409 { conflict = true; self.error = "Stock or preparation changed during this count. Close and reopen this product, then count again including the newly made containers." }
            }
        }
        busy = false
    }

    private static func message(_ error: any Error) -> String {
        guard let apiError = error as? APIClientError else { return HistoryFailure.message(error) }
        switch apiError {
        case .server(422, .validationFailed, let message, _):
            return message == "Count all locations for this product."
                ? "This stock update could not be saved. Close and reopen the product, then enter each location again."
                : message
        case .server(_, _, let message, _):
            return message
        case .transport:
            return "Can't reach the server. Check your connection and try again."
        default:
            return HistoryFailure.message(apiError)
        }
    }
    private func persist() {
        guard let persistenceKey else { return }
        if let operation, let data = try? JSONEncoder().encode(operation) { UserDefaults.standard.set(data, forKey: persistenceKey) }
        else { UserDefaults.standard.removeObject(forKey: persistenceKey) }
    }
}
