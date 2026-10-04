import Foundation
import Testing
@testable import DisplayRefillCore

private actor PhotoDouble: PhotoScanAPI {
    var calls: [(String, Data, String)] = []
    var uploadCount = 0
    var finalized = false
    func photoRequest(path: String, body: Data, key: String) async throws -> PhotoResponse {
        calls.append((path, body, key))
        if path.hasSuffix("finalize-upload") && !finalized { throw APIClientError.server(status: 503, code: .dependencyUnavailable, message: "Upload first", requestID: nil) }
        let json = """
        {"scan":{"scan_id":"11111111-1111-4111-8111-111111111111","status":"\(finalized ? "queued" : "awaiting_upload")","revision":1,"created_at":"2026-10-03T00:00:00Z","slots":[],"products":[],"unresolved_slot_ids":[]},"upload":{"expires_at":"2026-10-03T00:10:00Z"}}
        """
        return try JSONCoding.makeDecoder().decode(PhotoResponse.self, from: Data(json.utf8))
    }
    func uploadPhoto(id: String, jpeg: Data) async throws {
        uploadCount += 1
        if uploadCount == 1 { throw APIClientError.transport(.networkConnectionLost) }
        finalized = true
    }
    func reference(version: String) async throws -> ReferenceAccess { throw APIClientError.transport(.notConnectedToInternet) }
    func records() -> [(String,Data,String)] { calls }
    // Analysis polling: scripted detail responses (JSON) or errors, consumed in order; the last repeats.
    var details: [Result<String, APIClientError>] = []
    var detailCalls = 0
    var mutations: [(String, Data, String)] = []
    var mutationResults: [Result<String, APIClientError>] = []
    func script(details: [Result<String, APIClientError>] = [], mutations: [Result<String, APIClientError>] = []) { self.details = details; mutationResults = mutations }
    func detail(id: String) async throws -> ScanDetail {
        detailCalls += 1
        let next = details.count > 1 ? details.removeFirst() : details[0]
        return try JSONCoding.makeDecoder().decode(ScanDetail.self, from: Data(try next.get().utf8))
    }
    func mutate(path: String, method: String, body: Data, key: String) async throws -> ScanDetail {
        mutations.append((path, body, key))
        let next = mutationResults.count > 1 ? mutationResults.removeFirst() : mutationResults[0]
        return try JSONCoding.makeDecoder().decode(ScanDetail.self, from: Data(try next.get().utf8))
    }
    func mutationRecords() -> [(String, Data, String)] { mutations }
    func detailCount() -> Int { detailCalls }
}

private func scanJSON(status: String, revision: Int = 3, source: String = "photo", alignment: String? = nil, failure: String? = nil, retry: Bool = false,
                      synthetic: Bool = false, flags: [String] = [], slots: [(Int?, Bool)] = []) -> String {
    let slotJSON = slots.enumerated().map { i, s in
        "{\"slot_id\":\"s\(i)\",\"product_id\":\"p\",\"product_name\":\"Synthetic\",\"slot_label\":\"A\(i)\",\"target\":4,\"refill_threshold\":null,\"accepted_quantity\":\(s.0.map(String.init) ?? "null"),\"review_state\":\"pending\",\"refill_quantity\":null,\"ai_quantity\":\(s.0.map(String.init) ?? "null"),\"review_required\":\(s.1)}"
    }.joined(separator: ",")
    let a = alignment.map { "\"\($0)\"" } ?? "null", f = failure.map { "\"\($0)\"" } ?? "null"
    let flagJSON = flags.map { "\"\($0)\"" }.joined(separator: ",")
    return """
    {"scan_id":"11111111-1111-4111-8111-111111111111","status":"\(status)","source":"\(source)","revision":\(revision),"created_at":"2026-10-03T00:00:00Z","slots":[\(slotJSON)],"products":[],"unresolved_slot_ids":[],
     "analysis":{"generation":0,"failure_code":\(f),"retry_available":\(retry),"retries_remaining":2,"alignment":\(a),"image_flags":[\(flagJSON)],"provider":"mock","synthetic":\(synthetic),"manual_takeover_at":null}}
    """
}

/// Records requested sleeps and advances a fake clock; ends polling after `limit` sleeps.
private final class FakeClock: @unchecked Sendable {
    var now = Date(timeIntervalSince1970: 1_000)
    var sleeps: [Duration] = []
    let limit: Int
    init(limit: Int = 100) { self.limit = limit }
    func sleep(_ d: Duration) throws {
        sleeps.append(d)
        if sleeps.count >= limit { throw CancellationError() }
        now += TimeInterval(d.components.seconds)
    }
}

@MainActor private func finishedWorkflow(_ api: PhotoDouble, root: URL) async throws -> PhotoWorkflow {
    let display = try JSONDecoder().decode(ManualDisplay.self, from: Data("{\"display_id\":\"display\",\"name\":\"Fixture\",\"active_pog\":{\"pog_version_id\":\"pog\"}}".utf8))
    let model = PhotoWorkflow(api: api, display: display, userID: "actor", directory: root)
    model.setPhoto(Data([1, 2, 3]))
    await model.submit(); await model.submit()
    #expect(model.finished)
    return model
}

@Test func pollScheduleStartsAtTwoSecondsAndBacksOffToFive() {
    #expect((0..<10).map { AnalysisPolling.interval(afterPoll: $0) } == [2, 2, 2, 2, 2, 3, 4, 5, 5, 5].map { Duration.seconds($0) })
}

@Test @MainActor func pollingFollowsServerStateUntilReviewReadyWithoutInventingCounts() async throws {
    let api = PhotoDouble(); let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = try await finishedWorkflow(api, root: root)
    #expect(model.analysis == .waiting(processing: false, delayed: false))
    await api.script(details: [.success(scanJSON(status: "queued")), .success(scanJSON(status: "processing")),
                               .success(scanJSON(status: "needs_review", revision: 4, alignment: "good", synthetic: true, slots: [(2, false), (nil, true), (0, true)]))])
    let clock = FakeClock()
    await model.pollAnalysis(sleep: { try clock.sleep($0) }, now: { clock.now })
    #expect(clock.sleeps == [.seconds(2), .seconds(2)])
    guard case .reviewReady(let summary) = model.analysis else { Issue.record("expected review ready, got \(model.analysis)"); return }
    #expect(summary == ReviewSummary(scan: try JSONCoding.makeDecoder().decode(ScanDetail.self, from: Data(scanJSON(status: "needs_review", alignment: "good", synthetic: true, slots: [(2, false), (nil, true), (0, true)]).utf8))))
    #expect(summary.total == 3 && summary.estimated == 2 && summary.unknown == 1 && summary.needsVerification == 2 && summary.synthetic && !summary.alignmentUnclear)
}

@Test @MainActor func noWorkerShowsDelayAfterThirtySecondsInsteadOfEndlessProgress() async throws {
    let api = PhotoDouble(); let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = try await finishedWorkflow(api, root: root)
    await api.script(details: [.success(scanJSON(status: "queued"))])
    let clock = FakeClock(limit: 12)
    clock.now = Date() // finalizedAt was recorded with the real clock during submit
    await model.pollAnalysis(sleep: { try clock.sleep($0) }, now: { clock.now })
    #expect(model.analysis == .waiting(processing: false, delayed: true))
    #expect(clock.sleeps.allSatisfy { $0 <= .seconds(5) })
    #expect(await api.detailCount() == 12)
}

@Test @MainActor func connectivityLossKeepsPollingAndPoorAlignmentIsExplained() async throws {
    let api = PhotoDouble(); let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = try await finishedWorkflow(api, root: root)
    await api.script(details: [.failure(.transport(.notConnectedToInternet)), .success(scanJSON(status: "needs_review", alignment: "poor", flags: ["glare"], slots: [(nil, true)]))])
    let clock = FakeClock()
    await model.pollAnalysis(sleep: { try clock.sleep($0) }, now: { clock.now })
    guard case .reviewReady(let summary) = model.analysis else { Issue.record("expected review ready"); return }
    #expect(summary.alignmentUnclear && summary.estimated == 0 && summary.imageFlags == ["glare"])
    #expect(clock.sleeps.count == 1)
}

@Test @MainActor func failedAnalysisRetryReplaysExactBodyAndKeyAfterLostResponse() async throws {
    let api = PhotoDouble(); let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = try await finishedWorkflow(api, root: root)
    await api.script(details: [.success(scanJSON(status: "failed", revision: 5, failure: "PROVIDER_UNAVAILABLE", retry: true))],
                     mutations: [.failure(.transport(.networkConnectionLost)), .success(scanJSON(status: "queued", revision: 6))])
    let clock = FakeClock()
    await model.pollAnalysis(sleep: { try clock.sleep($0) }, now: { clock.now })
    #expect(model.analysis == .failed(code: "PROVIDER_UNAVAILABLE", retryAvailable: true))
    await model.retryAnalysis()
    #expect(model.analysis == .failed(code: "PROVIDER_UNAVAILABLE", retryAvailable: true))
    await model.retryAnalysis()
    #expect(model.analysis == .waiting(processing: false, delayed: false))
    let sent = await api.mutationRecords()
    #expect(sent.count == 2 && sent.allSatisfy { $0.0 == "api/v1/scans/11111111-1111-4111-8111-111111111111/retry" })
    #expect(sent[0].1 == sent[1].1 && sent[0].2 == sent[1].2)
    #expect(String(decoding: sent[0].1, as: UTF8.self) == "{\"expected_revision\":5}")
}

@Test @MainActor func failedWithoutRetryAndManualTakeoverStopPolling() async throws {
    let api = PhotoDouble(); let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = try await finishedWorkflow(api, root: root)
    await api.script(details: [.success(scanJSON(status: "failed", failure: "INVALID_OUTPUT", retry: false))])
    await model.pollAnalysis(sleep: { _ in }, now: Date.init)
    #expect(model.analysis == .failed(code: "INVALID_OUTPUT", retryAvailable: false))
    await model.retryAnalysis()
    #expect(await api.mutationRecords().isEmpty)
    await api.script(details: [.success(scanJSON(status: "needs_review", source: "manual"))])
    await model.pollAnalysis(sleep: { _ in }, now: Date.init)
    #expect(model.analysis == .manual(status: "needs_review"))
    await api.script(details: [.failure(.server(status: 404, code: .notFound, message: "gone", requestID: nil))])
    await model.pollAnalysis(sleep: { _ in Issue.record("must not keep polling after 404") }, now: Date.init)
}
@Test @MainActor func interruptedPhotoSubmissionRestoresExactBodyKeysAndCrop() async throws {
    let api = PhotoDouble()
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let display = try JSONDecoder().decode(ManualDisplay.self, from: Data("{\"display_id\":\"display\",\"name\":\"Fixture\",\"active_pog\":{\"pog_version_id\":\"pog\"}}".utf8))
    let model = PhotoWorkflow(api: api, display: display, userID: "actor", directory: root)
    let jpeg = Data([1,2,3])
    model.setPhoto(jpeg); model.crop.width = 0.5
    await model.submit()
    #expect(!model.finished && model.locked)
    let restored = PhotoWorkflow(api: api, display: display, userID: "actor", directory: root)
    #expect(restored.jpeg == jpeg && restored.crop.width == 0.5)
    await restored.submit()
    #expect(restored.finished)
    let calls = await api.records()
    #expect(calls.filter { $0.0 == "api/v1/scans" }.count == 1)
    let finals = calls.filter { $0.0.hasSuffix("finalize-upload") }
    #expect(finals.count == 3)
    #expect(finals.allSatisfy { $0.1 == finals[0].1 && $0.2 == finals[0].2 })
    let completed = PhotoWorkflow(api: api, display: display, userID: "actor", directory: root)
    #expect(completed.finished)
    let anotherAccount = PhotoWorkflow(api: api, display: display, userID: "other", directory: root)
    #expect(anotherAccount.jpeg == nil)
}

#if os(iOS)
import ImageIO
import UIKit
private func imageFixture(type: CFString, orientation: Int) throws -> Data {
    let image = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200)).image { context in
        for (index, color) in [UIColor.red, .green, .blue, .yellow].enumerated() {
            color.setFill(); context.fill(CGRect(x: index%2*100,y:index/2*100,width:100,height:100))
        }
    }.cgImage!
    let data = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(data, type, 1, nil))
    CGImageDestinationAddImage(destination,image,[kCGImagePropertyOrientation:orientation,kCGImagePropertyExifDictionary:[kCGImagePropertyExifUserComment:"private fixture"]] as CFDictionary)
    try #require(CGImageDestinationFinalize(destination))
    return data as Data
}
@Test func nativeAllEightOrientationFixturesAndMetadataRemoval() throws {
    let expected = [[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,0],[0,0,255],[255,255,0],[0,255,0]]
    for orientation in 1...8 {
        let jpeg = try PhotoImage.normalize(imageFixture(type:"public.jpeg" as CFString,orientation:orientation))
        let source = try #require(CGImageSourceCreateWithData(jpeg as CFData,nil))
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any])
        #expect(properties[kCGImagePropertyOrientation] == nil)
        #expect(properties[kCGImagePropertyGPSDictionary] == nil)
        let image = try #require(CGImageSourceCreateImageAtIndex(source,0,nil))
        var rgba = [UInt8](repeating:0,count:200*200*4)
        let context = try #require(CGContext(data:&rgba,width:200,height:200,bitsPerComponent:8,bytesPerRow:800,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image,in:CGRect(x:0,y:0,width:200,height:200))
        print("Orientation \(orientation), actual top-left: \(Array(rgba[(50*200+50)*4..<(50*200+50)*4+3]))")
        for channel in 0..<3 { #expect(abs(Int(rgba[(50*200+50)*4+channel])-expected[orientation-1][channel])<20) }
    }
}
@Test func nativeHEICImportProducesJPEGAndRejectsInvalidBytes() throws {
    let jpeg = try PhotoImage.normalize(imageFixture(type:"public.heic" as CFString,orientation:6))
    #expect(jpeg.prefix(3) == Data([255,216,255]))
    #expect(throws: PhotoImageError.self) { try PhotoImage.normalize(Data([0,1,2])) }
}
#endif
