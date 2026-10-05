import XCTest
@MainActor final class WasteWorkflowUITests: XCTestCase {
    struct Fixture: Decodable { let email: String; let password: String }
    func testWasteRecordSummaryUndoAndRelaunch() throws { try workflow(largest: false) }
    func testWasteAtLargestTextSize() throws { try workflow(largest: true) }
    private func workflow(largest: Bool) throws {
        guard let url = Bundle(for: Self.self).url(forResource: "ProductionFixture", withExtension: "json") else { throw XCTSkip("Local fixture required") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication(); app.launchArguments = ["-UIPreferredContentSizeCategoryName", largest ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]; app.launch()
        if app.buttons["Account"].waitForExistence(timeout: 5) { app.buttons["Account"].tap(); app.buttons["Sign out"].tap() }
        let email = app.textFields["Email"]; XCTAssertTrue(email.waitForExistence(timeout: 15)); email.tap(); email.typeText(fixture.email)
        let password = app.secureTextFields["Password"]; password.tap(); password.typeText(fixture.password); app.buttons["Sign in"].tap()
        let tab = app.tabBars.buttons["Waste Log"]; XCTAssertTrue(tab.waitForExistence(timeout: 20)); tab.tap()
        XCTAssertFalse(app.tabBars.buttons["Saved checks"].exists)
        let logButton = app.buttons["Log waste"]; XCTAssertTrue(logButton.waitForExistence(timeout: 15)); expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: logButton); waitForExpectations(timeout: 15); logButton.tap()
        let product = app.buttons["Choose product"]; XCTAssertTrue(product.waitForExistence(timeout: 10)); product.tap()
        let bowl = app.buttons["Synthetic Watermelon Bowl"]; XCTAssertTrue(bowl.waitForExistence(timeout: 10)); bowl.tap()
        let quantity = app.textFields["waste-quantity"]; XCTAssertTrue(quantity.waitForExistence(timeout: 10)); quantity.tap(); quantity.typeText("3")
        app.buttons["Close keyboard"].tap(); app.navigationBars["Log Waste"].buttons["Save"].tap()
        let totals = app.descendants(matching: .any).matching(identifier: "waste-totals").firstMatch; XCTAssertTrue(totals.waitForExistence(timeout: 15))
        let undo = app.buttons["Undo entry"].firstMatch
        for _ in 0..<12 { if undo.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(undo.waitForExistence(timeout: 10)); XCTAssertTrue(undo.isHittable)
        app.terminate(); app.launch(); app.tabBars.buttons["Stock Check"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "3 wasted")).firstMatch.waitForExistence(timeout: 15))
        app.tabBars.buttons["Waste Log"].tap()
        for _ in 0..<12 { if undo.isHittable { break }; app.swipeUp() }
        undo.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Undo 3 ·")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5)); confirm.tap()
        XCTAssertTrue(app.staticTexts["Undone"].waitForExistence(timeout: 15))
        for _ in 0..<10 { if totals.isHittable { break }; app.swipeDown() }
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "0 wasted")).firstMatch.waitForExistence(timeout: 15))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = largest ? "Waste largest text" : "Waste default"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }
}
