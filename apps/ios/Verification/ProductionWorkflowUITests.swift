import XCTest

@MainActor
final class ProductionWorkflowUITests: XCTestCase {
    struct Fixture: Decodable { let email: String; let password: String }
    private func run(largest: Bool) throws {
        guard let url = Bundle(for: Self.self).url(forResource: "ProductionFixture", withExtension: "json") else {
            throw XCTSkip("Requires a local synthetic ProductionFixture; never use production credentials.")
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", largest ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch()
        if app.buttons["Account"].waitForExistence(timeout: 5) {
            app.buttons["Account"].tap()
            if app.buttons["Sign out"].waitForExistence(timeout: 5) { app.buttons["Sign out"].tap() }
        }
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap(); email.typeText(fixture.email)
        let password = app.secureTextFields["Password"]
        password.tap(); password.typeText(fixture.password)
        app.buttons["Sign in"].tap()
        let fruit = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "1. Fruit mobile bunker")).firstMatch
        XCTAssertTrue(fruit.waitForExistence(timeout: 20))
        reach(fruit, app: app); fruit.tap()
        let have = app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "production-have-")).firstMatch
        XCTAssertTrue(have.waitForExistence(timeout: 15))
        reach(have, app: app); have.tap()
        if let value = have.value as? String, value != "Not counted", !value.isEmpty {
            have.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        have.typeText("7")
        if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        let backup = app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "production-backup-")).firstMatch
        if backup.exists {
            reach(backup, app: app); backup.tap()
            if let value = backup.value as? String, value != "Not counted", !value.isEmpty { backup.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count)) }
            backup.typeText("5")
            if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        }
        let saved = app.staticTexts["production-save-status"]
        let ready = NSPredicate(format: "label == %@", "All entries saved")
        expectation(for: ready, evaluatedWith: saved)
        waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["PAR"].exists)
        let finish = app.buttons["Finish & next section"]
        reach(finish, app: app)
        XCTAssertTrue(finish.isEnabled)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = largest ? "Worksheet largest text" : "Worksheet default text"; shot.lifetime = .keepAlways; add(shot)
        finish.tap()
        XCTAssertTrue(app.staticTexts["Synthetic Cobb Salad"].waitForExistence(timeout: 15))
        app.terminate()
    }
    private func reach(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<12 {
            if element.isHittable && element.frame.midY < app.frame.maxY - 100 { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }
    func testDefaultWorksheet() throws { try run(largest: false) }
    func testLargestWorksheet() throws { try run(largest: true) }
}
