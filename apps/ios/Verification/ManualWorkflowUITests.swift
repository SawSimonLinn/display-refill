import XCTest

/// Runs the installed iOS app using genuine Supabase Auth and Feature 06/07 APIs.
/// The local controller provisions synthetic data and can discard a committed
/// response or commit an edit from another client. No app test-mode bypass.
@MainActor
final class ManualWorkflowUITests: XCTestCase {
    struct Fixture: Decodable { let email, password, controlKey, controlURL, actor: String }
    struct Snapshot: Decodable {
        struct Slot: Decodable, Equatable { let label: String; let accepted, final, refill: Int? }
        struct Request: Decodable { let key: String; let body: Body; let status: Int
            struct Body: Decodable, Equatable { let expected_revision: Int; let items: [Item]
                struct Item: Decodable, Equatable { let slot_id: String; let quantity: Int; let verified: Bool; let reason: String }
            }
        }
        let scan_id, status: String
        let revision: Int
        let total_refill: Int?
        let completed_by: String?
        let slots: [Slot]
        let ledger: [Request]
    }
    private var app = XCUIApplication()
    private func fixture() throws -> Fixture {
        guard let url = Bundle(for: Self.self).url(forResource: "LocalFixture", withExtension: "json") else {
            throw XCTSkip("Use scripts/run-ios-simulator-tests.mjs with local synthetic Supabase.")
        }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
    private func control(_ path: String) async throws -> Data {
        let f = try fixture()
        var request = URLRequest(url: URL(string: f.controlURL + "/control/" + path)!)
        request.setValue("Bearer " + f.controlKey, forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return data
    }
    private func snapshot() async throws -> Snapshot { try JSONDecoder().decode(Snapshot.self, from: await control("snapshot")) }
    private func scroll(_ up: Bool, distance: CGFloat? = nil) {
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.55 : 0.25))
        let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.25 : 0.55))
        if let distance {
            let delta = min(max(distance, 16), app.frame.height * 0.3) / app.frame.height
            let precise = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: (up ? 0.55 : 0.25) + (up ? -delta : delta)))
            // A coarse flick can jump past a fully-visible interval and then
            // reverse forever. Use measured, slow drags; retain the same bounds.
            from.press(forDuration: 0.1, thenDragTo: precise, withVelocity: .slow, thenHoldForDuration: 0.2)
        } else {
            from.press(forDuration: 0.05, thenDragTo: to)
        }
    }
    private func reach(_ element: XCUIElement, up: Bool = true, fully: Bool = false) {
        // A partially visible button may be "hittable" even when its center is
        // under iOS's floating keyboard toolbar. Scroll the actual tap point clear.
        for direction in [up, !up] {
            for _ in 0..<12 {
                if element.exists {
                    let top = app.navigationBars.firstMatch.frame.maxY + 8
                    var bottom = app.frame.maxY - 90
                    if app.keyboards.firstMatch.exists {
                        bottom = app.keyboards.firstMatch.frame.minY - 8
                        let done = app.buttons["Done"].firstMatch
                        if done.exists && element.label != "Done" { bottom = min(bottom, done.frame.minY - 8) }
                    }
                    let frame = element.frame
                    let fits = fully && frame.height < bottom - top
                    let clear = fits ? frame.minY > top && frame.maxY < bottom : frame.midY > top && frame.midY < bottom
                    if element.isHittable && clear { return }
                    if fits {
                        let upward = frame.maxY >= bottom
                        let distance = upward ? frame.maxY - bottom + 16 : top - frame.minY + 16
                        print("Full reach \(element.label): frame=\(frame), viewport=\(top)...\(bottom), drag=\(upward ? distance : -distance)")
                        scroll(upward, distance: distance)
                    } else {
                        scroll(frame.midY >= bottom)
                    }
                } else { scroll(direction) }
            }
        }
        XCTFail("Expected an accessible, reachable control: \(element.label), frame=\(element.frame)")
    }
    private func tap(_ label: String) {
        let button = app.buttons[label].firstMatch
        if ["Done", "Account", "Sign out", "Confirm counts"].contains(label) {
            XCTAssertTrue(button.waitForExistence(timeout: 10))
            XCTAssertTrue(button.isHittable)
        } else {
            reach(button, up: !(label.hasPrefix("Retry") || label.hasPrefix("Reload")))
        }
        button.tap()
    }
    private func count(_ label: String) -> XCUIElement { app.textFields["Count for Synthetic Garden Salad, slot " + label] }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func audit(_ types: XCUIAccessibilityAuditType) {
        // Record audit failures without aborting independent persistence checks.
        let previous = continueAfterFailure
        continueAfterFailure = true
        defer { continueAfterFailure = previous }
        do {
            try app.performAccessibilityAudit(for: types) { issue in
                print("Accessibility issue: \(issue.compactDescription); \(issue.detailedDescription); label=\(issue.element?.label ?? "unknown")")
                return false
            }
        } catch { XCTFail("Accessibility audit failed: \(error)") }
    }
    func testManualWorkflowPersistenceConflictsAndAccessibility() async throws {
        try await runWorkflow(accessibilitySize: false)
    }
    func testManualWorkflowAtLargestAccessibilitySize() async throws {
        try await runWorkflow(accessibilitySize: true)
    }
    func testPhotoImportCropAndRecovery() async throws {
        let f = try fixture()
        _ = try await control("normal-type")
        app.launch()
        if app.textFields["Email"].waitForExistence(timeout: 5) {
            app.textFields["Email"].tap(); app.textFields["Email"].typeText(f.email)
            app.secureTextFields["Password"].tap(); app.secureTextFields["Password"].typeText(f.password)
            tap("Sign in")
        }
        let store = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Simulator Store")).firstMatch
        XCTAssertTrue(store.waitForExistence(timeout: 20)); store.tap()
        let display = app.buttons["Simulator Display"]
        XCTAssertTrue(display.waitForExistence(timeout: 15)); display.tap()
        tap("Photo check")
        tap("Import photo")
        let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH %@", "Photo,")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 15), app.debugDescription)
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let preview = app.images["photo-preview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 15), app.debugDescription)
        let width = app.sliders["Crop Width"]
        reach(width); width.adjust(toNormalizedSliderPosition: 0.5)
        let height = app.sliders["Crop Height"]
        reach(height); height.adjust(toNormalizedSliderPosition: 0.5)
        capture("photo-import-upright-crop")
        tap("Upload selected display photo")
        let notice = app.staticTexts["photo-notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 20))
        for _ in 0..<30 {
            if notice.label.contains("stored privately") { break }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertTrue(notice.label.contains("stored privately"), app.debugDescription)
        let stored = try await snapshot()
        XCTAssertEqual(stored.status,"queued")
        XCTAssertTrue(stored.slots.allSatisfy { $0.accepted == nil })
        XCTAssertNil(stored.total_refill)
        // Feature 09: no worker is running yet. The screen must show honest queued state,
        // then a delay notice with the manual option after 30 seconds, never fabricated progress.
        let status = app.staticTexts["analysis-status"]
        reach(status)
        XCTAssertTrue(status.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(status.label.contains("queued for analysis"), status.label)
        try await waitFor(status, containing: "taking longer than usual", seconds: 50)
        reach(status, fully: true)
        capture("photo-analysis-delayed-no-worker")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        let stillQueued = try await snapshot()
        XCTAssertEqual(stillQueued.status, "queued")
        // A local worker with the deterministic mock adapter now processes the durable job.
        _ = try await control("start-worker")
        try await waitFor(status, containing: "Analysis finished", seconds: 60)
        XCTAssertTrue(status.label.contains("1 of 2 slots have estimates; 1 need verification"), status.label)
        let synthetic = app.descendants(matching: .any)["analysis-synthetic"]
        reach(synthetic, fully: true)
        XCTAssertTrue(synthetic.exists, app.debugDescription)
        capture("photo-analysis-review-ready")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        let analysed = try await snapshot()
        XCTAssertEqual(analysed.status, "needs_review")
        XCTAssertEqual(analysed.slots.map(\.accepted), [1, nil]) // unknown stays unknown, never zero
        XCTAssertNil(analysed.total_refill)
        _ = try await control("large-type")
        reach(status, fully: true)
        capture("photo-analysis-review-ready-largest-text")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        _ = try await control("normal-type")
        app.terminate(); app.launch()
        XCTAssertTrue(store.waitForExistence(timeout: 20)); store.tap()
        XCTAssertTrue(display.waitForExistence(timeout: 15)); display.tap(); tap("Photo check")
        XCTAssertTrue(app.staticTexts["photo-notice"].waitForExistence(timeout: 15))
        try await waitFor(app.staticTexts["analysis-status"], containing: "Analysis finished", seconds: 20)
        tap("Start manual check")
        tap("Start manual check")
        XCTAssertTrue(count("A1").waitForExistence(timeout: 15))
        capture("photo-manual-fallback")
        // Return from the nested manual check (keyboard and pushed screens hide the tab bar).
        for _ in 0..<5 where !app.buttons["Account"].firstMatch.isHittable {
            if app.keyboards.firstMatch.exists && app.buttons["Done"].firstMatch.exists { app.buttons["Done"].firstMatch.tap() }
            else if app.navigationBars.buttons.firstMatch.exists { app.navigationBars.buttons.firstMatch.tap() }
        }
        tap("Account"); tap("Sign out")
    }
    private func waitFor(_ element: XCUIElement, containing text: String, seconds: Int) async throws {
        for _ in 0..<seconds {
            if element.exists && element.label.contains(text) { return }
            try await Task.sleep(for: .seconds(1))
        }
        XCTFail("Timed out waiting for \"\(text)\"; last label: \(element.exists ? element.label : "missing")")
    }
    private func runWorkflow(accessibilitySize: Bool) async throws {
        continueAfterFailure = true
        let f = try fixture()
        _ = try await control("reset-ledger")
        _ = try await control("normal-type")
        app.launch()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 15))
        app.textFields["Email"].tap(); app.textFields["Email"].typeText(f.email)
        app.secureTextFields["Password"].tap(); app.secureTextFields["Password"].typeText(f.password)
        tap("Sign in")
        let store = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Simulator Store")).firstMatch
        XCTAssertTrue(store.waitForExistence(timeout: 20)); store.tap()
        let display = app.buttons["Simulator Display"]
        XCTAssertTrue(display.waitForExistence(timeout: 15)); display.tap()
        tap("Start manual check")
        XCTAssertTrue(count("A1").waitForExistence(timeout: 15))
        if accessibilitySize { _ = try await control("large-type") }
        XCTAssertEqual(count("A1").value as? String, "Unknown")
        XCTAssertFalse(app.buttons["Increase count for slot A1"].isEnabled)
        XCTAssertFalse(app.buttons["Decrease count for slot A1"].isEnabled)
        reach(count("A2"))
        XCTAssertEqual(count("A2").value as? String, "Unknown")
        reach(app.buttons["Confirm counts and refill list"])
        XCTAssertFalse(app.buttons["Confirm counts and refill list"].isEnabled)
        capture(accessibilitySize ? "largest-unknown-validation-actions" : "default-unknown-validation-actions")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        reach(count("A1"), up: false); count("A1").tap(); count("A1").typeText("0")
        XCTAssertEqual(count("A1").value as? String, "0")
        XCTAssertFalse(app.buttons["Decrease count for slot A1"].isEnabled)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Numeric entry receives keyboard focus")
        reach(count("A2")); count("A2").tap(); count("A2").typeText("2")
        tap("Increase count for slot A2"); XCTAssertEqual(count("A2").value as? String, "3")
        tap("Decrease count for slot A2"); XCTAssertEqual(count("A2").value as? String, "2")
        tap("Done"); XCTAssertFalse(app.keyboards.firstMatch.exists)
        // Discard a successful server response: retry must replay exact bytes/key.
        _ = try await control("fail-next-save")
        tap("Save and review refill")
        XCTAssertTrue(app.buttons["Retry pending request"].waitForExistence(timeout: 15))
        capture(accessibilitySize ? "largest-retry-validation" : "default-retry-validation")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        reach(count("A1"), up: false); XCTAssertEqual(count("A1").value as? String, "0")
        reach(count("A2")); XCTAssertEqual(count("A2").value as? String, "2")
        tap("Retry pending request")
        reach(app.staticTexts["Refill total: 5"])
        XCTAssertTrue(app.staticTexts["Refill total: 5"].waitForExistence(timeout: 15))
        let replay = try await snapshot()
        XCTAssertEqual(replay.revision, 2)
        XCTAssertEqual(replay.ledger.count, 2)
        XCTAssertEqual(replay.ledger[0].key, replay.ledger[1].key)
        XCTAssertEqual(replay.ledger[0].body, replay.ledger[1].body)
        let grouped = app.buttons["Synthetic Garden Salad: Refill 5"]
        reach(grouped); grouped.tap()
        XCTAssertTrue(app.staticTexts["Slot A1: Refill 3"].exists)
        XCTAssertTrue(app.staticTexts["Slot A2: Refill 2"].exists)
        capture("server-grouped-refills")
        _ = try await control("stale")
        tap("Save and review refill")
        XCTAssertTrue(app.buttons["Reload latest and retain my entries"].waitForExistence(timeout: 15))
        capture(accessibilitySize ? "largest-conflict-validation" : "default-conflict-validation")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        tap("Reload latest and retain my entries")
        reach(count("A1"), up: false); XCTAssertEqual(count("A1").value as? String, "0")
        reach(count("A2")); XCTAssertEqual(count("A2").value as? String, "2")
        tap("Save and review refill")
        reach(app.staticTexts["Revision 4 · needs_review"], up: false)
        XCTAssertTrue(app.staticTexts["Revision 4 · needs_review"].waitForExistence(timeout: 15))
        _ = try await control("normal-type")
        reach(count("A1"), up: false)
        let normalCountHeight = count("A1").frame.height
        _ = try await control("large-type")
        reach(count("A1"), up: false); XCTAssertEqual(count("A1").value as? String, "0")
        XCTAssertGreaterThan(count("A1").frame.height, normalCountHeight * 1.5)
        capture("largest-dynamic-type-count-entry")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        reach(count("A2")); XCTAssertEqual(count("A2").value as? String, "2")
        reach(grouped, fully: true); XCTAssertTrue(grouped.exists)
        capture("largest-dynamic-type-refills")
        audit([.sufficientElementDescription, .hitRegion, .textClipped, .dynamicType])
        _ = try await control("normal-type")
        reach(grouped, fully: true); grouped.tap()
        // Native accessibility audit checks labels, actionable hit regions and clipped text.
        audit([.sufficientElementDescription, .hitRegion, .textClipped])
        capture("count-review-accessibility")
        if accessibilitySize { _ = try await control("large-type") }
        tap("Confirm counts and refill list"); tap("Confirm counts")
        XCTAssertTrue(app.buttons["Mark refill completed"].waitForExistence(timeout: 15))
        let frozen = try await snapshot()
        XCTAssertEqual(frozen.status, "confirmed")
        tap("Mark refill completed")
        let completionAction = app.sheets.buttons["Mark refill completed"].firstMatch
        XCTAssertTrue(completionAction.waitForExistence(timeout: 10))
        completionAction.tap()
        reach(app.staticTexts["Employee attested refill completion"])
        XCTAssertTrue(app.staticTexts["Employee attested refill completion"].waitForExistence(timeout: 15))
        let completed = try await snapshot()
        XCTAssertEqual(completed.status, "completed")
        XCTAssertEqual(completed.completed_by, f.actor)
        XCTAssertEqual(completed.slots, frozen.slots)
        XCTAssertEqual(completed.total_refill, 5)
        capture("completed-attestation")
        // Terminate the app process. AppStorage and the real simulator Keychain must survive.
        app.terminate(); app.launch()
        XCTAssertTrue(store.waitForExistence(timeout: 20))
        XCTAssertFalse(app.textFields["Email"].exists)
        app.tabBars.buttons["Saved checks"].tap()
        let saved = app.buttons["Check " + completed.scan_id.prefix(8)]
        XCTAssertTrue(saved.waitForExistence(timeout: 15)); saved.tap()
        reach(app.staticTexts["Employee attested refill completion"])
        XCTAssertTrue(app.staticTexts["Employee attested refill completion"].waitForExistence(timeout: 15))
        reach(app.staticTexts["Confirmed count: 0"]); XCTAssertTrue(app.staticTexts["Confirmed count: 0"].exists)
        reach(app.staticTexts["Confirmed count: 2"]); XCTAssertTrue(app.staticTexts["Confirmed count: 2"].exists)
        _ = try await control("normal-type")
        audit([.sufficientElementDescription, .hitRegion, .textClipped])
        capture("reopened-persisted-check")
        let attestation = app.staticTexts["Employee attested refill completion"]
        let normalAttestationHeight = attestation.frame.height
        _ = try await control("large-type")
        reach(attestation, fully: true)
        XCTAssertGreaterThan(attestation.frame.height, normalAttestationHeight * 1.5)
        capture("largest-dynamic-type-completion")
        audit([.sufficientElementDescription, .hitRegion, .dynamicType, .textClipped])
        _ = try await control("normal-type")
        app.navigationBars.buttons.firstMatch.tap()
        tap("Account"); tap("Sign out")
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 15))
        XCTAssertFalse(store.exists, "Logout persists across process restart")
    }
}
