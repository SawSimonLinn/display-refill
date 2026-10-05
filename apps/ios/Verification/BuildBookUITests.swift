import XCTest
@MainActor final class BuildBookUITests: XCTestCase {
    struct Fixture: Decodable { let email: String; let password: String }
    func testSearchAndOriginalRecipePages() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "ProductionFixture", withExtension: "json") else { throw XCTSkip("Local fixture required") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication(); app.launch()
        if app.buttons["Account"].waitForExistence(timeout: 5) {
            app.buttons["Account"].tap(); app.buttons["Sign out"].tap()
        }
        let email = app.textFields["Email"]; XCTAssertTrue(email.waitForExistence(timeout: 15)); email.tap(); email.typeText(fixture.email)
        let password = app.secureTextFields["Password"]; password.tap(); password.typeText(fixture.password); app.buttons["Sign in"].tap()
        let tab = app.tabBars.buttons["Build Book"]; XCTAssertTrue(tab.waitForExistence(timeout: 20)); tab.tap()
        let search = app.searchFields.firstMatch; XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap(); search.typeText("watermelon chunks cup")
        let recipe = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Watermelon Chunks Cup")).firstMatch
        XCTAssertTrue(recipe.waitForExistence(timeout: 10)); recipe.tap()
        XCTAssertTrue(app.otherElements["build-book-pdf"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "10oz")).firstMatch.waitForExistence(timeout: 10), "Original PDF must open at the ingredient page, not its cover")
        app.buttons["Page text"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "10oz")).firstMatch.waitForExistence(timeout: 5))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Build book recipe text"; shot.lifetime = .keepAlways; add(shot)
        app.terminate()
    }
}
