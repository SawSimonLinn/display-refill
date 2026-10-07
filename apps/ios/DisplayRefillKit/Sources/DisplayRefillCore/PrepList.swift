import Foundation
import Observation

public struct PrepBoard: Decodable, Sendable {
    public let updated_at: String
    public let items: [PrepItem]
    public let missing_sections: [ProductionSection]
    /// Containers on hand now: each product's last count plus preparation since.
    /// Products never counted are left out rather than guessed.
    public var onHand: Int { items.reduce(0) { $0 + StockUpdateModel.expectedCounts($1).values.reduce(0, +) } }
    /// Products with no count yet, so `onHand` can say it is incomplete.
    public var uncounted: Int { items.filter { !$0.locations.contains { $0.have != nil } }.count }
}
public struct PrepItem: Decodable, Sendable, Identifiable {
    public var id: String { product_id }
    public let product_id: String
    public let product_name: String
    public let category: String
    public let product_type: String
    public let ready: Bool
    public let needed: Int?
    public let made: Int
    public let remaining: Int?
    public let revision: String
    public let oldest_count: String
    public let locations: [Location]
    public let activity: [Activity]
    public struct Location: Decodable, Sendable {
        public let section: ProductionSection
        public let have: Int?
        public let backup: Int?
        public let backup_required: Bool?
        public let display_need: Int
        public let checked_at: String
    }
    public struct Activity: Decodable, Sendable {
        public let quantity: Int
        public let name: String
        public let at: String
    }
}
public struct PrepMutation: Codable, Sendable {
    public let product_id: String
    public let expected_revision: String
    public let quantity: Int?
    public let done: Bool
    public init(productID: String, revision: String, quantity: Int?, done: Bool) {
        product_id = productID; expected_revision = revision; self.quantity = quantity; self.done = done
    }
}
public protocol PrepAPI: Sendable {
    func prepBoard(storeID: String) async throws -> PrepBoard
    func recordPrep(storeID: String, mutation: PrepMutation, key: String) async throws -> PrepBoard
}
extension URLSessionAccountAPI: PrepAPI {
    public func prepBoard(storeID: String) async throws -> PrepBoard { try await authorizedRequest("api/v1/prep/\(storeID)") }
    public func recordPrep(storeID: String, mutation: PrepMutation, key: String) async throws -> PrepBoard {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try await authorizedRequest("api/v1/prep/\(storeID)", method: "POST", body: encoder.encode(mutation), key: key)
    }
}

/// Preparation is an additive event, never a replacement stock count.
/// Retain the exact payload and key until an uncertain write is resolved.
@MainActor @Observable public final class PrepListModel {
    public private(set) var board: PrepBoard?
    public private(set) var busy = false
    public private(set) var error: String?
    public private(set) var lastLoaded: Date?
    public private(set) var pending = false
    public private(set) var message: String?
    public var inputs: [String: String] = [:]
    public private(set) var loading = false
    private var generation = 0
    private let api: any PrepAPI
    private let storeID: String
    private struct Operation: Codable { let mutation: PrepMutation; let key: String; let input: String? }
    private let persistenceKey: String?
    private var operation: Operation?
    public init(api: any PrepAPI, storeID: String, persistenceKey: String? = nil) {
        self.api = api; self.storeID = storeID; self.persistenceKey = persistenceKey
        if let persistenceKey, let data = UserDefaults.standard.data(forKey: persistenceKey), let saved = try? JSONDecoder().decode(Operation.self, from: data) {
            operation = saved; pending = true; inputs[saved.mutation.product_id] = saved.input
            error = "A preparation save was interrupted. Retry to retrieve its outcome before recording more."
        }
    }
    private func persist() {
        guard let persistenceKey else { return }
        if let operation, let data = try? JSONEncoder().encode(operation) { UserDefaults.standard.set(data, forKey: persistenceKey) }
        else { UserDefaults.standard.removeObject(forKey: persistenceKey) }
    }
    public func refresh() async {
        guard !busy, !pending, !loading else { return }
        loading = true
        let stamp = generation
        defer { loading = false }
        do {
            let result = try await api.prepBoard(storeID: storeID)
            guard stamp == generation, !pending else { return }
            board = result; lastLoaded = Date(); error = nil
        } catch {
            guard stamp == generation else { return }
            self.error = Self.errorMessage(error)
            if case .server(let status, _, _, _) = error as? APIClientError, [401, 403, 404].contains(status) { board = nil }
        }
    }
    public func record(_ item: PrepItem, done: Bool = false) async {
        guard !busy, operation == nil, item.ready, (item.remaining ?? 0) > 0 else { return }
        let text = inputs[item.id] ?? ""
        let quantity = Int(text)
        if !done && (text.isEmpty || !ProductionWorksheet.valid(text) || (quantity ?? 0) < 1 || (quantity ?? 0) > (item.remaining ?? 0)) {
            error = "Enter a whole number from 1 to \(item.remaining ?? 0)."; return
        }
        // Done keeps the amount it covered so the box can keep showing it.
        operation = Operation(mutation: .init(productID: item.id, revision: item.revision, quantity: done ? nil : quantity, done: done), key: UUID().uuidString, input: done ? String(item.remaining ?? 0) : inputs[item.id])
        pending = true; persist()
        await send()
    }
    public func retry() async { if operation != nil { await send() } else { await refresh() } }
    private func send() async {
        guard !busy, let op = operation else { return }
        generation += 1
        busy = true; error = nil; message = nil
        do {
            board = try await api.recordPrep(storeID: storeID, mutation: op.mutation, key: op.key)
            lastLoaded = Date()
            // Keep the recorded amount visible; Done shows the amount it covered.
            if op.mutation.done { inputs[op.mutation.product_id] = op.input }
            operation = nil; pending = false; persist()
            message = "Preparation saved for the team."
        } catch {
            self.error = Self.errorMessage(error)
            if case .server(let status, _, _, _) = error as? APIClientError, (400..<500).contains(status), status != 429 {
                operation = nil; pending = false; persist()
                if status == 409 {
                    // Refresh does not resubmit a stale Done amount or erase typed input.
                    do { board = try await api.prepBoard(storeID: storeID); lastLoaded = Date() } catch { }
                    self.error = "Stock or preparation changed. Your entry is kept. Review the latest amount before recording again."
                }
            }
        }
        busy = false
    }
    private static func errorMessage(_ error: any Error) -> String {
        if case .server(_, _, let message, _) = error as? APIClientError { return message }
        return HistoryFailure.message(error)
    }
}
