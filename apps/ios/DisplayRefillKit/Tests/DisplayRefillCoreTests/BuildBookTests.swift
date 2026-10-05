import Foundation
import Testing
@testable import DisplayRefillCore

@Suite struct BuildBookTests {
    @Test func originalBookAndIndexCoverEveryPhysicalPage() throws {
        let entries = try BuildBookLibrary.load()
        let pages = entries.flatMap(\.pages)
        #expect(pages.sorted() == Array(1...326))
        #expect(Set(entries.map(\.id)).count == entries.count)
        #expect(BuildBookLibrary.pdfURL != nil)
        let watermelon = try #require(entries.first { $0.title == "Watermelon Chunks Cup" })
        #expect(watermelon.pages == [63, 64])
        #expect(watermelon.text.contains("10oz"))
    }
    @Test func searchFindsProductsAndIngredientsAndFiltersCategories() throws {
        let entries = try BuildBookLibrary.load()
        let results = BuildBookLibrary.search(entries, query: " WATERMELON chunks cup ", category: "Fruit")
        #expect(results.first?.title == "Watermelon Chunks Cup")
        #expect(results.allSatisfy { $0.category == "Fruit" })
        #expect(!BuildBookLibrary.search(entries, query: "cucumber").isEmpty)
        #expect(BuildBookLibrary.search(entries, query: "zzzzmissing").isEmpty)
        #expect(BuildBookLibrary.search(entries, query: "", category: "Salads").allSatisfy { $0.category == "Salads" })
    }
    @Test func defaultPrepOrderStartsWithFiveDollarFruitAndKeepsFamiliesTogether() {
        func item(_ id: String, _ name: String, _ section: ProductionSection, _ remaining: Int) -> PrepItem {
            PrepItem(product_id: id, product_name: name, category: "", product_type: "", ready: true, needed: remaining, made: 0, remaining: remaining, revision: "1", oldest_count: "", locations: [.init(section: section, have: 0, backup: nil, backup_required: nil, display_need: remaining, checked_at: "")], activity: [])
        }
        let items = [item("salad", "Cobb", .saladMobile, 30), item("cup", "Watermelon cup", .fruitCase, 12), item("veg", "Carrots", .veggieCase, 20), item("ten", "$10 Watermelon", .fruitCase, 3), item("five", "$5 Watermelon", .fruitMobile, 2)]
        #expect(PrepPresentation.sorted(items, by: .sections).map(\.id) == ["five", "ten", "cup", "veg", "salad"])
        #expect(PrepPresentation.sorted(items, by: .quantity).first?.id == "salad")
        #expect(PrepPresentation.locationLabel(.fruitCase) == "D. 6ft Fruit")
    }
}
