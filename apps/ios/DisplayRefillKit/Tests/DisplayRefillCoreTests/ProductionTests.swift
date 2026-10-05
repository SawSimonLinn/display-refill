import Foundation
import Testing
@testable import DisplayRefillCore

private actor ProductionStub: ProductionAPI {
    var calls: [(ProductionMutation, String)] = []
    var failNext = false
    var delayed = false
    var shared = false
    var backup: Int?
    func share() { shared = true }
    var quantity: Int?
    func fail() { failNext = true }
    func delay() { delayed = true }
    func record() -> [(ProductionMutation, String)] { calls }
    func productionDay(storeID: String) async throws -> ProductionDay { .init(date: "2026-10-03", sections: [], total_make: 0, complete: false) }
    func productionCheck(storeID: String, checkID: String) async throws -> ProductionCheck { result() }
    func result() -> ProductionCheck {
        .init(id: "check", section: .fruitMobile, revision: calls.count, status: "draft", items: [.init(id: "i", product_id: "p", product_name: "Fruit", category: "Fruit", product_type: "Bowl", have: quantity, make: quantity.map { max(0, 10 - $0) }, backup: backup, backup_required: shared, shared_size: shared ? 2 : 1)], total_make: nil)
    }
    func productionMutate(storeID: String, mutation: ProductionMutation, key: String) async throws -> ProductionCheck {
        calls.append((mutation, key))
        if failNext { failNext = false; throw APIClientError.transport(.timedOut) }
        if delayed { delayed = false; try await Task.sleep(for: .milliseconds(50)) }
        if mutation.action == "counts" { quantity = mutation.items?.first?.have; backup = mutation.items?.first?.backup }
        return result()
    }
}
@Suite @MainActor struct ProductionTests {
    @Test func sharedItemNeedsOnlyHaveAndReturnsSectionShortageAfterRetry() async throws {
        let api = ProductionStub(); await api.share()
        let model = ProductionWorksheet(api: api, storeID: "s")
        await model.start(.fruitMobile)
        #expect(!model.canFinish)
        model.edit("i", text: "7")
        await api.fail(); await model.save(); await model.retry()
        #expect(model.canFinish)
        #expect(model.check?.items.first?.make == 3)
        let calls = await api.record()
        #expect(calls[1].1 == calls[2].1)
        #expect(calls[2].0.items?.first?.backup == 0)
        #expect(calls[2].0.items?.first?.includesBackup == true)
        model.edit("i", text: ""); await model.save()
        #expect(!model.canFinish)
    }
    @Test func blankAndZeroEncodeDifferently() throws {
        let blank = try JSONEncoder().encode(ProductionMutation.Count(id: "i", have: nil))
        let zero = try JSONEncoder().encode(ProductionMutation.Count(id: "i", have: 0))
        #expect(String(decoding: blank, as: UTF8.self).contains("null"))
        #expect(!String(decoding: zero, as: UTF8.self).contains("null"))
        #expect(ProductionWorksheet.valid(""))
        #expect(ProductionWorksheet.valid("0"))
        #expect(!ProductionWorksheet.valid("-1"))
        #expect(!ProductionWorksheet.valid("10000"))
        #expect(!ProductionWorksheet.valid("1.5"))
    }
    @Test func retryKeepsExactKeyAndPayload() async throws {
        let api = ProductionStub(); let model = ProductionWorksheet(api: api, storeID: "s")
        await model.start(.fruitMobile)
        model.edit("i", text: "0")
        await api.fail(); await model.save()
        #expect(model.pending)
        await model.retry()
        let calls = await api.record()
        #expect(calls[1].1 == calls[2].1)
        #expect(calls[1].0.items?.first?.have == calls[2].0.items?.first?.have)
        #expect(model.check?.items.first?.make == 10)
        #expect(model.saved)
    }
    @Test func editsDuringSlowSaveSurviveAndAreSavedNext() async throws {
        let api = ProductionStub(); let model = ProductionWorksheet(api: api, storeID: "s")
        await model.start(.fruitMobile)
        model.edit("i", text: "2"); await api.delay()
        let task = Task { await model.save() }
        try await Task.sleep(for: .milliseconds(15))
        model.edit("i", text: "7")
        await task.value
        #expect(model.input["i"] == "7")
        #expect(model.check?.items.first?.have == 7)
        #expect(model.check?.items.first?.make == 3)
        #expect(model.saved)
    }
    @Test func cannotFinishUncountedSection() async {
        let api = ProductionStub(); let model = ProductionWorksheet(api: api, storeID: "s")
        await model.start(.fruitMobile)
        #expect(!model.canFinish)
        model.edit("i", text: "0"); await model.save()
        #expect(model.canFinish)
        model.edit("i", text: ""); await model.save()
        #expect(!model.canFinish)
        #expect(model.check?.items.first?.have == nil)
    }
}
