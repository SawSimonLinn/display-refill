import Foundation
import Testing
@testable import DisplayRefillCore
private actor WasteStub: OperationsAPI {
    var lost = false
    var delay = false
    var quantity = 0
    var keys: [String] = []
    var seen: Set<String> = []
    func loseResponse() { lost = true }
    func delayRead() { delay = true }
    func calls() -> [String] { keys }
    private func snapshot() -> OperationsReport {
        .init(business_date: "2026-10-05", period: "day", start_date: "2026-10-05", end_date: "2026-10-05", timezone: "America/Los_Angeles", made: 20, wasted: quantity, products: [], catalog: [], entries: [])
    }
    func operations(storeID: String, day: String?, period: String) async throws -> OperationsReport {
        let result = snapshot()
        if delay { delay = false; try await Task.sleep(for: .milliseconds(80)) }
        return result
    }
    func recordWaste(storeID: String, mutation: WasteMutation, key: String) async throws -> OperationsReport {
        keys.append(key)
        if seen.insert(key).inserted { quantity += mutation.quantity ?? 0 }
        if lost { lost = false; throw APIClientError.transport(.timedOut) }
        return snapshot()
    }
}
@Suite @MainActor struct WasteTests {
    @Test func lostResponseSurvivesRelaunchAndRetriesTheSameOperation() async throws {
        let key = "waste-test-" + UUID().uuidString; defer { UserDefaults.standard.removeObject(forKey: key) }
        let api = WasteStub(); let first = WasteLogModel(api: api, storeID: "s", persistenceKey: key)
        let mutation = WasteMutation.record(product: "p", quantity: 5, reason: .expired, note: "", day: "2026-10-05")
        await api.loseResponse(); await first.save(mutation); #expect(first.pending)
        let restored = WasteLogModel(api: api, storeID: "s", persistenceKey: key)
        #expect(restored.pendingMutation == mutation); await restored.retry()
        #expect(restored.saved); #expect(!restored.pending); #expect(restored.report?.wasted == 5)
        let keys = await api.calls(); #expect(keys.count == 2); #expect(keys[0] == keys[1])
        #expect(UserDefaults.standard.data(forKey: key) == nil)
    }
    @Test func earlierReadCannotOverwriteASavedWasteEntry() async throws {
        let api = WasteStub(); let model = WasteLogModel(api: api, storeID: "s")
        await api.delayRead(); let old = Task { await model.load() }
        try await Task.sleep(for: .milliseconds(10))
        await model.save(.record(product: "p", quantity: 3, reason: .quality, note: "", day: "2026-10-05")); await old.value
        #expect(model.report?.wasted == 3)
    }
    @Test func invalidQuantityDoesNotSendAndDatesUseStoreMidnight() async throws {
        let api = WasteStub(); let model = WasteLogModel(api: api, storeID: "s")
        await model.save(.record(product: "p", quantity: 0, reason: .expired, note: "", day: "2026-10-05"))
        #expect(await api.calls().isEmpty)
        let date = try #require(ISO8601DateFormatter().date(from: "2026-09-14T06:59:59Z"))
        #expect(StoreDay.string(date, timezone: "America/Los_Angeles") == "2026-09-13")
        #expect(StoreDay.string(date, timezone: "UTC") == "2026-09-14")
    }
}
