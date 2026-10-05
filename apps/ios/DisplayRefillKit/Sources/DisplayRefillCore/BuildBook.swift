import Foundation

public struct BuildBookEntry: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let category: String
    public let pages: [Int]
    public let text: String
    public var pageLabel: String { pages.count == 1 ? "Page \(pages[0])" : "Pages \(pages.first ?? 1)–\(pages.last ?? 1)" }
}
public enum BuildBookLibrary {
    public enum LoadError: Error { case missingResources }
    public static var pdfURL: URL? { Bundle.module.url(forResource: "BuildBook", withExtension: "pdf") }
    public static func load() throws -> [BuildBookEntry] {
        guard let url = Bundle.module.url(forResource: "BuildBookIndex", withExtension: "json"), pdfURL != nil else { throw LoadError.missingResources }
        return try JSONDecoder().decode([BuildBookEntry].self, from: Data(contentsOf: url))
    }
    public static func search(_ entries: [BuildBookEntry], query: String, category: String = "") -> [BuildBookEntry] {
        let terms = folded(query).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return entries.filter { entry in
            (category.isEmpty || entry.category == category) && terms.allSatisfy { folded(entry.title + " " + entry.text).contains($0) }
        }.sorted { a, b in
            if !terms.isEmpty {
                let at = terms.allSatisfy { folded(a.title).contains($0) }, bt = terms.allSatisfy { folded(b.title).contains($0) }
                if at != bt { return at }
            }
            return (a.pages.first ?? 0) < (b.pages.first ?? 0)
        }
    }
    private static func folded(_ value: String) -> String { value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")) }
}
