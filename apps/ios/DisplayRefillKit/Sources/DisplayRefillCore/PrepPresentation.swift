import Foundation

public enum PrepSortOrder: String, CaseIterable, Sendable {
    case sections, quantity, name
    public var label: String {
        switch self { case .sections: "Fruit first · $5 bowls"; case .quantity: "Largest amount first"; case .name: "Product name" }
    }
}
public enum PrepPresentation {
    public static func family(_ item: PrepItem) -> String {
        if item.locations.contains(where: { $0.section == .fruitMobile || $0.section == .fruitCase }) { return "Fruit" }
        if item.locations.contains(where: { $0.section == .veggieCase }) { return "Vegetables" }
        return "Salads"
    }
    public static func fruitCategory(_ item: PrepItem) -> String {
        if item.product_name.hasPrefix("$5") || item.category == "$5 bowls" { return "$5 bowls" }
        if item.product_name.hasPrefix("$10") || item.category == "$10 bowls" { return "$10 bowls" }
        return item.category
    }
    public static func sorted(_ items: [PrepItem], by order: PrepSortOrder) -> [PrepItem] {
        let groups = ["Fruit", "Vegetables", "Salads"]
        let categories = ["$5 bowls", "$10 bowls", "Top row", "2 for 6", "Party tray"]
        return items.sorted { a, b in
            if order == .sections {
                let ag = groups.firstIndex(of: family(a)) ?? 3, bg = groups.firstIndex(of: family(b)) ?? 3
                if ag != bg { return ag < bg }
                if ag == 0 {
                    let ac = categories.firstIndex(of: fruitCategory(a)) ?? 5, bc = categories.firstIndex(of: fruitCategory(b)) ?? 5
                    if ac != bc { return ac < bc }
                }
            } else if order == .quantity, a.remaining != b.remaining { return (a.remaining ?? -1) > (b.remaining ?? -1) }
            let comparison = a.product_name.localizedStandardCompare(b.product_name)
            return comparison == .orderedSame ? a.id < b.id : comparison == .orderedAscending
        }
    }
    public static func locationLabel(_ section: ProductionSection) -> String {
        switch section {
        case .fruitMobile: "M. M1 Bunker"
        case .saladMobile: "M. Salad bunker"
        case .fruitCase: "D. 6ft Fruit"
        case .veggieCase: "D. Veggie display"
        }
    }
}
