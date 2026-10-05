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
        let fruit = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "1. M1 BUNKER (FRUIT)")).firstMatch
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
        XCTAssertFalse(backup.exists)
        XCTAssertFalse(app.staticTexts["After both sections"].exists)
        let saved = app.staticTexts["production-save-status"]
        let ready = NSPredicate(format: "label == %@", "All entries saved")
        expectation(for: ready, evaluatedWith: saved)
        waitForExpectations(timeout: 15)
        XCTAssertFalse(app.staticTexts["PAR"].exists)
        let make = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "production-make-")).firstMatch
        XCTAssertEqual(make.label, "TO MAKE, 3")
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
    func testFruitCategoriesAndKeyboardNextAtLargestSize() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "ProductionFixture", withExtension: "json") else { throw XCTSkip("Local synthetic fixture required") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        if app.buttons["Account"].waitForExistence(timeout: 5) { app.buttons["Account"].tap(); if app.buttons["Sign out"].waitForExistence(timeout: 5) { app.buttons["Sign out"].tap() } }
        let email = app.textFields["Email"]; XCTAssertTrue(email.waitForExistence(timeout: 15)); email.tap(); email.typeText(fixture.email)
        let password = app.secureTextFields["Password"]; password.tap(); password.typeText(fixture.password); app.buttons["Sign in"].tap()
        let fruit = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "3. 6FT FRUIT")).firstMatch
        XCTAssertTrue(fruit.waitForExistence(timeout: 20)); reach(fruit, app: app); fruit.tap()
        let first = app.textFields["Have, Synthetic Pineapple Cup"]
        XCTAssertTrue(first.waitForExistence(timeout: 15)); reach(first, app: app); first.tap(); first.typeText("7")
        app.buttons["Next item"].tap(); app.typeText("4"); app.buttons["Done"].tap()
        XCTAssertEqual(first.value as? String, "7")
        let second = app.textFields["Have, Synthetic 2 for 6"]
        XCTAssertEqual(second.value as? String, "4")
        for _ in 0..<8 { if app.staticTexts["Top row"].isHittable { break }; app.swipeDown() }
        for name in ["Top row", "2 for 6", "$5 bowls", "$10 bowls", "Party tray"] {
            let heading = app.staticTexts[name]; reach(heading, app: app); XCTAssertTrue(heading.exists)
        }
        XCTAssertFalse(app.staticTexts["PAR"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Fruit categories largest text"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }

}
