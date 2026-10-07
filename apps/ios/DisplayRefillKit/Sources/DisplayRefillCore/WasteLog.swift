import Foundation
import Observation

public enum WasteReason: String, Codable, CaseIterable, Sendable {
    case expired, quality, damaged, other
    public var label: String { switch self { case .expired: "Expired"; case .quality: "Quality"; case .damaged: "Damaged"; case .other: "Other" } }
}
public struct OperationsReport: Decodable, Sendable {
    public let business_date: String
    public let period: String
    public let start_date: String
    public let end_date: String
    public let timezone: String
    public let made: Int
    public let wasted: Int
    public let products: [Product]
    public let catalog: [CatalogItem]
    public let entries: [Entry]
    /// Every calendar day in the period, oldest first. Absent from older servers.
    public var days: [Day]?
    /// Net waste per reason for the period, largest first.
    public var reasons: [ReasonTotal]?
    public struct Day: Decodable, Sendable, Identifiable, Equatable {
        public var id: String { date }
        public let date: String
        public let made: Int
        public let wasted: Int
        public init(date: String, made: Int, wasted: Int) { self.date = date; self.made = made; self.wasted = wasted }
    }
    public struct ReasonTotal: Decodable, Sendable, Identifiable, Equatable {
        public var id: WasteReason { reason }
        public let reason: WasteReason
        public let wasted: Int
    }
    /// Products with waste in this period, most wasted first.
    public var mostWasted: [Product] { products.filter { $0.wasted > 0 }.sorted { ($0.wasted, $1.product_name) > ($1.wasted, $0.product_name) } }
    public struct CatalogItem: Decodable, Sendable, Identifiable {
        public var id: String { product_id }
        public let product_id: String
        public let product_name: String
        public let category: String
        public let product_type: String
        public let family: String
    }
    public struct Product: Decodable, Sendable, Identifiable {
        public var id: String { product_id }
        public let product_id: String
        public let product_name: String
        public let category: String
        public let product_type: String
        public let family: String
        public let made: Int
        public let wasted: Int
    }
    public struct Entry: Decodable, Sendable, Identifiable {
        public let id: String
        public let product_id: String
        public let product_name: String
        public let quantity: Int
        public let reason: WasteReason
        public let note: String
        public let business_date: String
        public let created_at: String
        public let actor_name: String
        public let voided: Bool
        public let can_void: Bool
        /// True when this entry was replaced by a corrected one rather than undone.
        public var edited: Bool?
    }
}
public struct WasteMutation: Codable, Sendable, Equatable {
    public let action: String
    public let product_id: String?
    public let quantity: Int?
    public let reason: WasteReason?
    public let note: String?
    public let business_date: String?
    public let entry_id: String?
    public static func record(product: String, quantity: Int, reason: WasteReason, note: String, day: String) -> Self {
        .init(action: "record", product_id: product, quantity: quantity, reason: reason, note: note, business_date: day, entry_id: nil)
    }
    /// Corrects an entry: the server voids it and records the new values on the same day.
    public static func edit(_ id: String, quantity: Int, reason: WasteReason, note: String) -> Self {
        .init(action: "edit", product_id: nil, quantity: quantity, reason: reason, note: note, business_date: nil, entry_id: id)
    }
    public static func undo(_ id: String) -> Self {
        .init(action: "void", product_id: nil, quantity: nil, reason: nil, note: nil, business_date: nil, entry_id: id)
    }
}
public protocol OperationsAPI: Sendable {
    func operations(storeID: String, day: String?, period: String) async throws -> OperationsReport
    func recordWaste(storeID: String, mutation: WasteMutation, key: String) async throws -> OperationsReport
}
extension URLSessionAccountAPI: OperationsAPI {
    public func operations(storeID: String, day: String? = nil, period: String = "day") async throws -> OperationsReport {
        var parts = URLComponents(); parts.queryItems = [URLQueryItem(name: "period", value: period)]
        if let day { parts.queryItems?.append(URLQueryItem(name: "day", value: day)) }
        return try await authorizedRequest("api/v1/operations/\(storeID)?\(parts.percentEncodedQuery ?? "")")
    }
    public func recordWaste(storeID: String, mutation: WasteMutation, key: String) async throws -> OperationsReport {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try await authorizedRequest("api/v1/waste/\(storeID)", method: "POST", body: encoder.encode(mutation), key: key)
    }
}
public enum StoreDay {
    public static func string(_ date: Date, timezone: String) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; return formatter.string(from: date)
    }
    /// Midnight at the start of a `yyyy-MM-dd` store day.
    public static func date(_ day: String, timezone: String) -> Date? {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; return formatter.date(from: day)
    }
    /// The Sunday-to-Saturday week containing `day`, matching the server's week period.
    public static func week(containing day: String, timezone: String) -> [String] {
        guard let start = date(day, timezone: timezone) else { return [] }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)!
        let sunday = calendar.date(byAdding: .day, value: 1 - calendar.component(.weekday, from: start), to: start) ?? start
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: sunday).map { string($0, timezone: timezone) } }
    }
    /// `day` moved by whole days, in the store's calendar.
    public static func shift(_ day: String, by days: Int, timezone: String) -> String {
        guard let start = date(day, timezone: timezone) else { return day }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)!
        return calendar.date(byAdding: .day, value: days, to: start).map { string($0, timezone: timezone) } ?? day
    }
}
@MainActor @Observable public final class WasteLogModel {
    public private(set) var report: OperationsReport?
    /// The Sunday-to-Saturday week around the loaded day, for totals and the day strip.
    public private(set) var week: OperationsReport?
    public private(set) var error: String?
    public private(set) var busy = false
    public private(set) var loading = false
    public private(set) var pending = false
    public private(set) var saved = false
    public private(set) var pendingMutation: WasteMutation?
    private let api: any OperationsAPI
    private let storeID: String
    private let persistenceKey: String?
    private struct Operation: Codable { let mutation: WasteMutation; let key: String }
    private var operation: Operation?
    private var generation = 0
    private var weekGeneration = 0
    public init(api: any OperationsAPI, storeID: String, persistenceKey: String? = nil) {
        self.api = api; self.storeID = storeID; self.persistenceKey = persistenceKey
        if let persistenceKey, let data = UserDefaults.standard.data(forKey: persistenceKey), let op = try? JSONDecoder().decode(Operation.self, from: data) {
            operation = op; pending = true; pendingMutation = op.mutation
            error = "Retry the interrupted waste save before recording it again."
        }
    }
    public func load(day: String? = nil) async {
        guard !busy, !pending else { return }
        generation += 1; let stamp = generation; loading = true
        if let day, report?.business_date != day { report = nil }
        do {
            let result = try await api.operations(storeID: storeID, day: day, period: "day")
            guard stamp == generation else { return }
            report = result; error = nil
        } catch {
            guard stamp == generation else { return }
            self.error = HistoryFailure.message(error); report = nil
        }
        if stamp == generation { loading = false }
        await loadWeek(day: report?.business_date ?? day)
    }
    private func loadWeek(day: String?) async {
        weekGeneration += 1; let stamp = weekGeneration
        let result = try? await api.operations(storeID: storeID, day: day, period: "week")
        guard stamp == weekGeneration else { return }
        if let result { week = result } else if let day, let week, !(week.start_date...week.end_date).contains(day) { self.week = nil }
    }
    public func save(_ mutation: WasteMutation) async {
        guard !busy, operation == nil else { return }
        if mutation.action == "record", (mutation.product_id?.isEmpty != false || !(1...9999).contains(mutation.quantity ?? 0)) { error = "Choose a product and enter 1–9999 containers."; return }
        if mutation.action == "edit", !(1...9999).contains(mutation.quantity ?? 0) { error = "Enter 1–9999 containers."; return }
        saved = false; generation += 1
        operation = .init(mutation: mutation, key: UUID().uuidString); pending = true; pendingMutation = mutation; persist()
        await retry()
    }
    public func retry() async {
        guard !busy, let op = operation else { return }
        busy = true; error = nil
        do {
            report = try await api.recordWaste(storeID: storeID, mutation: op.mutation, key: op.key)
            operation = nil; pendingMutation = nil; pending = false; saved = true; persist()
            busy = false; loading = false
            await loadWeek(day: report?.business_date)
            return
        } catch {
            self.error = HistoryFailure.message(error)
            if case .server(let status, _, _, _) = error as? APIClientError, (400..<500).contains(status), status != 429 {
                operation = nil; pendingMutation = nil; pending = false; persist()
                if [401, 403, 404].contains(status) { report = nil }
            }
        }
        busy = false; loading = false
    }
    private func persist() {
        guard let persistenceKey else { return }
        if let operation, let data = try? JSONEncoder().encode(operation) { UserDefaults.standard.set(data, forKey: persistenceKey) }
        else { UserDefaults.standard.removeObject(forKey: persistenceKey) }
    }
}
