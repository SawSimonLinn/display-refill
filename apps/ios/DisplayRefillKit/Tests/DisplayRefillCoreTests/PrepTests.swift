import Foundation
import Testing
@testable import DisplayRefillCore
private actor PrepStub: PrepAPI {
    var delayRead = false
    func delayNextRead() { delayRead = true }
    var made = 0
    var fail = false
    var conflict = false
    var calls: [(PrepMutation, String)] = []
    func failNext() { fail = true }
    func conflictNext() { conflict = true }
    func recorded() -> [(PrepMutation, String)] { calls }
    func prepBoard(storeID: String) async throws -> PrepBoard {
        let snapshot = PrepBoard(updated_at: "now", items: [.init(product_id: "p", product_name: "Watermelon", category: "Fruit", product_type: "Bowl", ready: true, needed: 25, made: made, remaining: 25 - made, revision: String(made), oldest_count: "now", locations: [], activity: [])], missing_sections: [])
        if delayRead { delayRead = false; try await Task.sleep(for: .milliseconds(80)) }
        return snapshot
    }
    func recordPrep(storeID: String, mutation: PrepMutation, key: String) async throws -> PrepBoard {
        calls.append((mutation, key))
        if fail { fail = false; throw APIClientError.transport(.timedOut) }
        if conflict { conflict = false; made = 22; throw APIClientError.server(status: 409, code: .conflict, message: "Changed", requestID: nil) }
        made += mutation.done ? 25 - made : mutation.quantity ?? 0
        return try await prepBoard(storeID: storeID)
    }
}
@Suite @MainActor struct PrepTests {
    @Test func backgroundRefreshDoesNotBlockOrOverwriteANewerSave() async throws {
        let api = PrepStub(); let model = PrepListModel(api: api, storeID: "s")
        await model.refresh(); let item = try #require(model.board?.items.first)
        await api.delayNextRead(); let refresh = Task { await model.refresh() }
        try await Task.sleep(for: .milliseconds(15)); #expect(!model.busy)
        model.inputs["p"] = "20"; await model.record(item); await refresh.value
        #expect(model.board?.items.first?.remaining == 5)
        #expect(await api.recorded().count == 1)
    }
    @Test func partialAndDoneUseServerRemaining() async throws {
        let api = PrepStub(); let model = PrepListModel(api: api, storeID: "s")
        await model.refresh(); model.inputs["p"] = "20"
        await model.record(try #require(model.board?.items.first))
        #expect(model.board?.items.first?.remaining == 5)
        #expect(model.inputs["p"] == "20")
        await model.record(try #require(model.board?.items.first), done: true)
        #expect(model.board?.items.first?.remaining == 0)
        #expect(model.inputs["p"] == "5")
        let calls = await api.recorded(); #expect(calls.last?.0.done == true); #expect(calls.last?.0.quantity == nil)
    }
    @Test func uncertainSaveSurvivesRelaunchWithExactKeyAndPayload() async throws {
        let key = "prep-test-" + UUID().uuidString; defer { UserDefaults.standard.removeObject(forKey: key) }
        let api = PrepStub(); let first = PrepListModel(api: api, storeID: "s", persistenceKey: key)
        await first.refresh(); first.inputs["p"] = "20"; await api.failNext()
        await first.record(try #require(first.board?.items.first)); #expect(first.pending)
        let restored = PrepListModel(api: api, storeID: "s", persistenceKey: key)
        #expect(restored.pending); #expect(restored.inputs["p"] == "20")
        await restored.retry(); #expect(!restored.pending); #expect(restored.board?.items.first?.remaining == 5)
        let calls = await api.recorded(); #expect(calls[0].1 == calls[1].1); #expect(calls[0].0.quantity == calls[1].0.quantity)
        #expect(UserDefaults.standard.data(forKey: key) == nil)
    }
    @Test func conflictRefreshesWithoutResubmittingDoneOrLosingTypedAmount() async throws {
        let api = PrepStub(); let model = PrepListModel(api: api, storeID: "s")
        await model.refresh(); model.inputs["p"] = "20"; await api.conflictNext()
        await model.record(try #require(model.board?.items.first), done: true)
        #expect(model.inputs["p"] == "20"); #expect(model.board?.items.first?.remaining == 3); #expect(!model.pending)
        let calls = await api.recorded(); #expect(calls.count == 1)
    }
    @Test func invalidAndExcessAmountsDoNotSubmit() async throws {
        let api = PrepStub(); let model = PrepListModel(api: api, storeID: "s")
        await model.refresh()
        for value in ["", "-1", "0", "1.5", "26"] { model.inputs["p"] = value; await model.record(try #require(model.board?.items.first)) }
        #expect(await api.recorded().isEmpty)
    }
}
