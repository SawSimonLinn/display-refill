import XCTest

@MainActor final class ProductionWorksheetUITests: XCTestCase {
    struct Fixture: Decodable { let email, password: String }
    func testWorksheetDefault() throws { try run(large: false) }
    func testWorksheetLargestText() throws { try run(large: true) }
    private func run(large: Bool) throws {
        guard let url = Bundle(for: Self.self).url(forResource: "ProductionFixture", withExtension: "json") else { throw XCTSkip("Local synthetic worksheet fixture required") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication()
        if large { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        if app.buttons["Account"].waitForExistence(timeout: 3) {
            app.buttons["Account"].tap(); app.buttons["Sign out"].tap()
        }
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
        app.textFields["Email"].tap(); app.textFields["Email"].typeText(fixture.email)
        app.secureTextFields["Password"].tap(); app.secureTextFields["Password"].typeText(fixture.password)
        app.buttons["Sign in"].tap()
        let fruit = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "1. Fruit mobile bunker")).firstMatch
        XCTAssertTrue(fruit.waitForExistence(timeout: 20), app.debugDescription)
        fruit.tap()
        let fields = app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "production-have-"))
        XCTAssertTrue(fields.firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["PAR"].exists)
        for index in 0..<fields.count {
            let field = fields.element(boundBy: index)
            for _ in 0..<8 where !field.isHittable { app.swipeUp() }
            field.tap()
            let old = field.value as? String ?? ""
            if Int(old) != nil { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count)) }
            field.typeText("1")
        }
        if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        let saved = app.staticTexts["production-save-status"]
        let savedExpectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "All entries saved"), object: saved)
        XCTAssertEqual(XCTWaiter.wait(for: [savedExpectation], timeout: 15), .completed)
        let finish = app.buttons["Finish & next section"]
        for _ in 0..<10 where !finish.isHittable { app.swipeUp() }
        XCTAssertTrue(finish.isHittable)
        XCTAssertTrue(finish.isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways; add(attachment)
        try app.performAccessibilityAudit(for: [.textClipped, .sufficientElementDescription])
        finish.tap()
        XCTAssertTrue(app.staticTexts["Salad mobile"].waitForExistence(timeout: 15), app.debugDescription)
        app.terminate()
    }
}
