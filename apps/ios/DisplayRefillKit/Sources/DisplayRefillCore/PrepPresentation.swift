import Foundation

public enum PrepSortOrder: String, CaseIterable, Sendable {
    case sections, quantity, name
    public var label: String {
        switch self { case .sections: "Fruit first · by produce"; case .quantity: "Largest amount first"; case .name: "Product name" }
    }
}
public enum PrepPresentation {
    /// Fruit is prepped one produce at a time, filling every $5 and $10 cup from the same cut.
    /// Each entry is the produce heading and the name fragments that identify it, checked in order
    /// (watermelon before mixed melon, since "watermelon" also contains "melon").
    private static let produceOrder: [(name: String, matches: [String])] = [
        ("Watermelon", ["watermelon"]),
        ("Mixed melon", ["mixed melon", "melon mix", "mix melon"]),
        ("Cantaloupe", ["cantaloup", "canteloup", "rockmelon"]),
        ("Honeydew", ["honeydew", "honey dew"]),
        ("Pineapple", ["pineapple"]),
    ]
    /// Words that describe the cut, size or mix rather than the produce itself.
    private static let descriptors: Set<String> = ["mixed", "mix", "fresh", "cut", "sliced", "diced", "cubed", "chopped", "small", "large", "mini", "big", "half", "whole", "bowl", "bowls", "cup", "cups", "spear", "spears", "chunk", "chunks", "tray", "party"]
    /// The produce a fruit product is made from, so "$10 WATERMELON", "$5 WATERMELON CUP" and
    /// "WATERMELON SPEARS" share "Watermelon". Products outside `produceOrder` use their first meaningful word.
    public static func produce(_ item: PrepItem) -> String {
        let name = item.product_name.lowercased()
        if let known = produceOrder.first(where: { $0.matches.contains { name.contains($0) } }) { return known.name }
        let words = name.split(whereSeparator: { !$0.isLetter }).map(String.init).filter { !descriptors.contains($0) }
        guard var word = words.first else { return item.product_name }
        if word.count > 3, word.hasSuffix("s"), !word.hasSuffix("ss") { word.removeLast() }
        return word.prefix(1).uppercased() + word.dropFirst()
    }
    private static func produceRank(_ produce: String) -> Int {
        produceOrder.firstIndex { $0.name == produce } ?? produceOrder.count
    }
    /// Produce choices for the Prep List filter, in the kitchen's prep order.
    public static func produceOptions(_ items: [PrepItem]) -> [String] {
        Set(items.filter { family($0) == "Fruit" }.map(produce)).sorted { a, b in
            let ar = produceRank(a), br = produceRank(b)
            return ar != br ? ar < br : a.localizedStandardCompare(b) == .orderedAscending
        }
    }
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
                    let ap = produce(a), bp = produce(b)
                    if ap != bp {
                        let ar = produceRank(ap), br = produceRank(bp)
                        return ar != br ? ar < br : ap.localizedStandardCompare(bp) == .orderedAscending
                    }
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
