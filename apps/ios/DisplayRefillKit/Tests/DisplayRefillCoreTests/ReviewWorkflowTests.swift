import Foundation
import Testing
@testable import DisplayRefillCore

/// A photo scan in review: A1 low confidence, A2 possible wrong product, A3 no estimate,
/// A4 high confidence (no review required). Unresolved IDs come from the server.
private func reviewScan(revision: Int = 4, accepted: [Int?] = [3, 2, nil, 5], verified: Set<Int> = [], unresolved: [Int] = [0, 1, 2], status: String = "needs_review", imageFlags: [String] = []) throws -> ScanDetail {
    let ai: [Int?] = [3, 2, nil, 5], confidence = ["0.62", "0.91", "null", "0.97"], flags = ["[]", "[\"wrong_product\"]", "[\"occluded\"]", "[]"], required = [true, true, true, false]
    let slots = (0..<4).map { i in
        "{\"slot_id\":\"s\(i)\",\"product_id\":\"p\",\"product_name\":\"Synthetic\",\"slot_label\":\"A\(i + 1)\",\"target\":6,\"refill_threshold\":null,"
        + "\"accepted_quantity\":\(accepted[i].map(String.init) ?? "null"),\"review_state\":\"\(verified.contains(i) ? "verified" : "pending")\",\"refill_quantity\":null,"
        + "\"ai_quantity\":\(ai[i].map(String.init) ?? "null"),\"confidence\":\(confidence[i]),\"flags\":\(flags[i]),\"review_required\":\(required[i])}"
    }.joined(separator: ",")
    let ids = unresolved.map { "\"s\($0)\"" }.joined(separator: ",")
    let json = """
    {"scan_id":"scan","status":"\(status)","source":"photo","revision":\(revision),"created_at":"2026-10-03T12:00:00Z","slots":[\(slots)],"products":[],
     "unresolved_slot_ids":[\(ids)],"provisional_total_refill":null,"total_refill":null,
     "analysis":{"generation":0,"failure_code":null,"retry_available":false,"retries_remaining":2,"alignment":"good","image_flags":[\(imageFlags.map { "\"\($0)\"" }.joined(separator: ","))],"provider":"mock","synthetic":true,"manual_takeover_at":null}}
    """
    return try JSONCoding.makeDecoder().decode(ScanDetail.self, from: Data(json.utf8))
}
private actor ReviewFake: ManualScanAPI {
    var current: ScanDetail
    var failure: APIClientError?
    var bodies: [Data] = []
    init(_ scan: ScanDetail) { current = scan }
    func set(_ scan: ScanDetail) { current = scan }
    func fail(_ error: APIClientError?) { failure = error }
    func displays(store: String) async throws -> [ManualDisplay] { [] }
    func detail(id: String) async throws -> ScanDetail { current }
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail {
        bodies.append(body)
        if let failure { throw failure }
        return current
    }
    func sent() -> [Data] { bodies }
}
private func items(_ body: Data) throws -> [[String: Any]] {
    let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    return try #require(object["items"] as? [[String: Any]])
}

@Test @MainActor func requiredReviewSlotsComeFirstAndBlockConfirmation() async throws {
    let api = ReviewFake(try reviewScan(unresolved: [2, 0]))
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    #expect(model.reviewsEstimates)
    #expect(model.orderedSlots.map(\.slotLabel) == ["A1", "A3", "A2", "A4"])
    #expect(model.inputs["s0"] == "3" && model.inputs["s2"] == "") // estimates prefilled, unknown stays blank
    #expect(model.valid && !model.dirty && !model.canSave && !model.canConfirm)
    #expect(model.review(of: model.scan!.slots[0]) == .needsVerification)
    #expect(model.review(of: model.scan!.slots[3]) == .estimate)
    await model.confirm()
    #expect(await api.sent().isEmpty)
}

@Test @MainActor func acceptingUnchangedEstimateIsExplicitAndSentWithZeroDelta() async throws {
    let api = ReviewFake(try reviewScan())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    let a1 = model.scan!.slots[0]
    #expect(model.canCheck(a1) && !model.canCheck(model.scan!.slots[2])) // nothing to accept when unknown
    model.setChecked(a1.id, true)
    #expect(model.review(of: a1) == .checkedUnsaved && model.dirty && model.canSave && !model.canConfirm)
    // Correct the wrong-product slot, enter the unknown one, leave the high-confidence estimate untouched.
    model.inputs["s1"] = "1"
    model.inputs["s2"] = "0"
    #expect(model.review(of: model.scan!.slots[1]) == .unsavedEdit)
    await api.set(try reviewScan(revision: 5, accepted: [3, 1, 0, 5], verified: [0, 1, 2], unresolved: []))
    await model.save()
    let sent = try items(try #require(await api.sent().first))
    #expect(sent.count == 3)
    #expect(sent[0]["slot_id"] as? String == "s0" && sent[0]["quantity"] as? Int == 3 && sent[0]["verified"] as? Bool == true && sent[0]["reason"] as? String == "visibility_check")
    #expect(sent[1]["slot_id"] as? String == "s1" && sent[1]["quantity"] as? Int == 1 && sent[1]["reason"] as? String == "wrong_product")
    #expect(sent[2]["slot_id"] as? String == "s2" && sent[2]["quantity"] as? Int == 0 && sent[2]["reason"] as? String == "manual_count")
    #expect(model.checked.isEmpty && !model.dirty && model.canConfirm)
    #expect(model.review(of: model.scan!.slots[0]) == .verified)
    // Server values drive the screen; the original estimate stays visible beside the saved count.
    #expect(model.scan!.slots[1].aiQuantity == 2 && model.scan!.slots[1].acceptedQuantity == 1)
}

@Test @MainActor func correctionsNeedValidNumbersAndCannotClearAnEstimate() async throws {
    let api = ReviewFake(try reviewScan())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    model.inputs["s0"] = ""
    #expect(!model.valid && !model.canSave) // the API has no way to make a count unknown again
    model.inputs["s0"] = "4"
    #expect(!model.canCheck(model.scan!.slots[0])) // a changed value is a correction, not an acceptance
    model.setChecked("s0", true)
    model.inputs["s0"] = "1000"
    #expect(!model.canSave)
    model.inputs["s0"] = "4"
    await model.save()
    let sent = try items(try #require(await api.sent().first))
    #expect(sent.count == 1 && sent[0]["quantity"] as? Int == 4 && sent[0]["reason"] as? String == "count_corrected" && sent[0]["verified"] as? Bool == true)
}

@Test @MainActor func conflictKeepsChecksAndCorrectionsForExplicitResave() async throws {
    let api = ReviewFake(try reviewScan())
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    model.setChecked("s0", true)
    model.inputs["s1"] = "1"
    await api.fail(.server(status: 409, code: .conflict, message: "", requestID: nil))
    await model.save()
    #expect(model.conflict && !model.canSave && model.inputs["s1"] == "1" && model.checked == ["s0"])
    // Another device verified A1 as 3 meanwhile; A2's estimate is unchanged.
    await api.set(try reviewScan(revision: 6, verified: [0], unresolved: [1, 2]))
    await model.load(id: "scan", preserve: true)
    #expect(model.scan?.revision == 6 && model.inputs["s1"] == "1")
    #expect(model.review(of: model.scan!.slots[0]) == .verified) // already verified: nothing to resend
    await api.fail(nil)
    await model.save()
    let bodies = await api.sent()
    let object = try #require(JSONSerialization.jsonObject(with: bodies[1]) as? [String: Any])
    #expect(object["expected_revision"] as? Int == 6)
    #expect(try items(bodies[1]).map { $0["slot_id"] as? String } == ["s1"])
}

@Test @MainActor func confirmedReviewIsReadOnly() async throws {
    let api = ReviewFake(try reviewScan(revision: 7, accepted: [3, 1, 0, 5], verified: [0, 1, 2], unresolved: [], status: "confirmed"))
    let model = ManualWorkflow(api: api)
    await model.load(id: "scan")
    #expect(!model.canCheck(model.scan!.slots[3]))
    model.setChecked("s3", true)
    model.inputs["s0"] = "9"
    await model.save(); await model.confirm()
    #expect(await api.sent().isEmpty)
}

@Test func reasonsExplainFlagsWithoutAssertingIdentity() throws {
    let scan = try reviewScan()
    #expect(ReviewReason.reasons(for: scan.slots[0], analysis: scan.analysis) == [.lowConfidence])
    #expect(ReviewReason.reasons(for: scan.slots[1], analysis: scan.analysis) == [.wrongProduct])
    #expect(ReviewReason.reasons(for: scan.slots[2], analysis: scan.analysis) == [.occluded, .noEstimate])
    #expect(ReviewReason.reasons(for: scan.slots[3], analysis: scan.analysis).isEmpty)
    let flagged = try reviewScan(imageFlags: ["glare"])
    #expect(ReviewReason.reasons(for: flagged.slots[0], analysis: flagged.analysis) == [.photoIssue])
    #expect(ReviewReason.wrongProduct.explanation.contains("may") && ReviewReason.wrongProduct.explanation.contains("can't confirm"))
    #expect(ReviewReason.occluded.explanation.contains("can't show hidden stock"))
}
