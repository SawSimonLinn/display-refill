import XCTest
@MainActor final class PrepWorkflowUITests: XCTestCase {
    struct Fixture: Decodable { let email: String; let password: String }
    private func open(largest: Bool) throws -> XCUIApplication {
        guard let url = Bundle(for: Self.self).url(forResource: "ProductionFixture", withExtension: "json") else { throw XCTSkip("Local synthetic fixture required") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", largest ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch()
        if app.buttons["Account"].waitForExistence(timeout: 5) { app.buttons["Account"].tap(); if app.buttons["Sign out"].waitForExistence(timeout: 5) { app.buttons["Sign out"].tap() } }
        let email = app.textFields["Email"]; XCTAssertTrue(email.waitForExistence(timeout: 15)); email.tap(); email.typeText(fixture.email)
        let password = app.secureTextFields["Password"]; password.tap(); password.typeText(fixture.password); app.buttons["Sign in"].tap()
        let tab = app.tabBars.buttons["Prep List"]; XCTAssertTrue(tab.waitForExistence(timeout: 20)); tab.tap()
        XCTAssertTrue(app.staticTexts["prep-total"].waitForExistence(timeout: 15))
        return app
    }
    private func reach(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<16 { if element.isHittable && element.frame.midY < app.frame.maxY - 100 { return }; app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    func testDefaultPartialPrepAndReopen() throws {
        let app = try open(largest: false)
        let remaining = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "prep-remaining-")).firstMatch
        XCTAssertTrue(remaining.waitForExistence(timeout: 15)); reach(remaining, app: app)
        let initial = try XCTUnwrap(Int(remaining.label.split(separator: " ").first ?? "")); XCTAssertGreaterThan(initial, 2)
        let input = app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "prep-input-")).firstMatch
        reach(input, app: app); input.tap(); input.typeText("2"); app.buttons["Close keyboard"].tap()
        let record = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "prep-record-")).firstMatch
        reach(record, app: app); record.tap()
        expectation(for: NSPredicate(format: "label == %@", "\(initial - 2) remaining"), evaluatedWith: remaining); waitForExpectations(timeout: 15)
        app.terminate(); app.launch(); app.tabBars.buttons["Prep List"].tap()
        XCTAssertTrue(remaining.waitForExistence(timeout: 15)); expectation(for: NSPredicate(format: "label == %@", "\(initial - 2) remaining"), evaluatedWith: remaining); waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["PAR"].exists)
        app.terminate()
    }
    func testLargestPrepDone() throws {
        let app = try open(largest: true)
        let done = app.buttons["Done · made all remaining"]
        XCTAssertTrue(done.waitForExistence(timeout: 15)); reach(done, app: app); done.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "Record ", " made")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        let total = app.staticTexts["prep-total"]
        expectation(for: NSPredicate(format: "label == %@", "0 to make"), evaluatedWith: total); waitForExpectations(timeout: 15)
        app.buttons["Filters"].tap()
        let completed = app.switches["Show completed items"]
        reach(completed, app: app); XCTAssertTrue(completed.isHittable); completed.tap()
        expectation(for: NSPredicate(format: "value == %@", "1"), evaluatedWith: completed)
        waitForExpectations(timeout: 5)
        app.navigationBars["Filters"].buttons["Done"].tap()
        let row = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "prep-remaining-")).firstMatch
        reach(row, app: app); XCTAssertEqual(row.label, "0 remaining")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Prep largest text"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }
    func testQuickStockAtLargestSize() throws {
        let app = try open(largest: true)
        app.tabBars.buttons["Stock Check"].tap()
        let quick = app.buttons["Quick stock update"]
        XCTAssertTrue(quick.waitForExistence(timeout: 10)); reach(quick, app: app); quick.tap()
        let product = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Synthetic Watermelon Bowl")).firstMatch
        reach(product, app: app); XCTAssertTrue(product.exists); product.tap()
        for (key, value) in [("fruit_mobile", "5"), ("fruit_case", "16")] {
            let input = app.textFields["quick-stock-input-" + key]
            XCTAssertTrue(input.waitForExistence(timeout: 10)); reach(input, app: app)
            XCTAssertEqual(input.value as? String, value)
            input.tap(); input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count)); input.typeText(value)
            if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        }
        let save = app.buttons["quick-stock-save"]; reach(save, app: app); save.tap()
        let editor = app.navigationBars["Recount Product"]
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: editor)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(product.exists)
        product.tap()
        let reopened = app.textFields["quick-stock-input-fruit_mobile"]
        XCTAssertTrue(reopened.waitForExistence(timeout: 10)); XCTAssertEqual(reopened.value as? String, "5")
        app.buttons["Close"].tap()
        let prepTab = app.tabBars.buttons["Prep List"]
        XCTAssertTrue(prepTab.isHittable); prepTab.tap()
        let total = app.staticTexts["prep-total"]
        expectation(for: NSPredicate(format: "label == %@", "25 to make"), evaluatedWith: total); waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["PAR"].exists)
        app.terminate()
    }

}
