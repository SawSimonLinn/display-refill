import Foundation
import Testing
@testable import DisplayRefillCore
private actor StockStub: StockUpdateAPI {
    var calls: [(StockMutation, String)] = []
    var fail = true
    var validationFail = false
    func rejectValidation() { validationFail = true; fail = false }
    func recorded() -> [(StockMutation, String)] { calls }
    func updateStock(storeID: String, mutation: StockMutation, key: String) async throws -> PrepBoard {
        calls.append((mutation, key))
        if fail { fail = false; throw APIClientError.transport(.timedOut) }
        if validationFail { validationFail = false; throw APIClientError.server(status: 422, code: .validationFailed, message: "Count all locations for this product.", requestID: nil) }
        return .init(updated_at: "now", items: [], missing_sections: [])
    }
}
@Suite @MainActor struct StockTests {
    private var item: PrepItem { .init(product_id: "p", product_name: "Fruit", category: "Fruit", product_type: "Bowl", ready: true, needed: 5, made: 0, remaining: 5, revision: "old", oldest_count: "now", locations: [.init(section: .fruitMobile, have: 5, backup: 0, backup_required: true, display_need: 5, checked_at: "now"), .init(section: .fruitCase, have: 31, backup: nil, backup_required: false, display_need: 5, checked_at: "now")], activity: []) }
    @Test func reopeningSeedsSavedCountsWithoutReplacingEdits() async {
        let model = StockUpdateModel(api: StockStub(), storeID: "s")
        model.loadCounts(item)
        #expect(model.inputs["fruit_mobile"] == "5")
        #expect(model.inputs["fruit_case"] == "31")
        model.inputs["fruit_mobile"] = "0"
        model.loadCounts(item)
        #expect(model.inputs["fruit_mobile"] == "0")
        #expect(!model.pending)
    }
    @Test func seedAddsMadeSplitByDisplayNeed() {
        func item(made: Int, needs: [Int], haves: [Int?] = [5, 31]) -> PrepItem {
            .init(product_id: "p", product_name: "Fruit", category: "Fruit", product_type: "Bowl", ready: true, needed: 10, made: made, remaining: 0, revision: "r", oldest_count: "now", locations: [.init(section: .fruitMobile, have: haves[0], backup: nil, backup_required: false, display_need: needs[0], checked_at: "now"), .init(section: .fruitCase, have: haves[1], backup: nil, backup_required: false, display_need: needs[1], checked_at: "now")], activity: [])
        }
        #expect(StockUpdateModel.expectedCounts(item(made: 10, needs: [6, 4])) == [.fruitMobile: 11, .fruitCase: 35])
        #expect(StockUpdateModel.expectedCounts(item(made: 5, needs: [1, 1])) == [.fruitMobile: 8, .fruitCase: 33])
        #expect(StockUpdateModel.expectedCounts(item(made: 3, needs: [0, 0])) == [.fruitMobile: 7, .fruitCase: 32])
        #expect(StockUpdateModel.expectedCounts(item(made: 4, needs: [3, 3], haves: [nil, 31])) == [.fruitCase: 35])
        let model = StockUpdateModel(api: StockStub(), storeID: "s")
        model.loadCounts(item(made: 10, needs: [6, 4]))
        #expect(model.inputs["fruit_mobile"] == "11"); #expect(model.inputs["fruit_case"] == "35")
    }
    @Test func restoredRetryCountsAreNotReplacedByOlderSavedCounts() async {
        let model = StockUpdateModel(api: StockStub(), storeID: "s")
        model.inputs = ["fruit_mobile": "0", "fruit_case": "33"]
        await model.save(item)
        #expect(model.pending)
        model.loadCounts(item)
        #expect(model.inputs["fruit_mobile"] == "0")
        #expect(model.inputs["fruit_case"] == "33")
    }
    @Test func partialInputCannotReplaceAllLocations() async {
        let api = StockStub(); let model = StockUpdateModel(api: api, storeID: "s")
        model.inputs["fruit_mobile"] = "10"; await model.save(item)
        #expect(await api.recorded().isEmpty); #expect(model.error != nil)
    }

    @Test func validationFailureUsesStockSaveMessage() async {
        let api = StockStub(); await api.rejectValidation()
        let model = StockUpdateModel(api: api, storeID: "s")
        model.inputs = ["fruit_mobile": "10", "fruit_case": "33"]
        await model.save(item)
        #expect(model.error == "This stock update could not be saved. Close and reopen the product, then enter each location again.")
        #expect(!model.pending)
    }
    @Test func interruptedStockUpdateRestoresBothLocationsAndTheExactKey() async throws {
        let key = "stock-test-" + UUID().uuidString; defer { UserDefaults.standard.removeObject(forKey: key) }
        let api = StockStub(); let model = StockUpdateModel(api: api, storeID: "s", persistenceKey: key)
        model.inputs = ["fruit_mobile": "10", "fruit_case": "33"]
        await model.save(item); #expect(model.pending)
        let restored = StockUpdateModel(api: api, storeID: "s", persistenceKey: key)
        #expect(restored.inputs["fruit_case"] == "33"); await restored.save(item); #expect(restored.saved)
        let calls = await api.recorded(); #expect(calls.count == 2); #expect(calls[0].1 == calls[1].1); #expect(calls[1].0.counts[0].backup == 0); #expect(calls[1].0.counts[1].backup == nil)
    }
    @Test func onHandAddsPrepSinceCountAndSkipsUncountedProducts() {
        func item(_ id: String, made: Int, have: [Int?]) -> PrepItem {
            .init(product_id: id, product_name: id, category: "Fruit", product_type: "Bowl", ready: true, needed: nil, made: made, remaining: nil, revision: "1", oldest_count: "now",
                  locations: have.enumerated().map { .init(section: [ProductionSection.fruitMobile, .fruitCase][$0.offset], have: $0.element, backup: nil, backup_required: nil, display_need: 2, checked_at: "now") }, activity: [])
        }
        let board = PrepBoard(updated_at: "now", items: [item("a", made: 3, have: [4, 1]), item("b", made: 0, have: [0]), item("c", made: 5, have: [nil])], missing_sections: [])
        #expect(board.onHand == 8); #expect(board.uncounted == 1)
    }
}
