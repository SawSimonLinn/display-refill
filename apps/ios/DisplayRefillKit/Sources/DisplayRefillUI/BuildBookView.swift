import DisplayRefillCore
import SwiftUI
import PDFKit

struct BuildBookView: View {
    @State private var entries: [BuildBookEntry] = []
    @State private var query = ""
    @State private var category = ""
    @State private var failed = false
    private var results: [BuildBookEntry] {
        let matches = BuildBookLibrary.search(entries, query: query, category: category)
        return query.isEmpty && category.isEmpty ? matches.filter { $0.category != "Guides" } : matches
    }
    var body: some View {
        List {
            if failed {
                Text("Build book could not be opened.")
                Button("Try again") { load() }
            } else {
                if query.isEmpty {
                    NavigationLink("Open full build book") { BookPages(page: 1).navigationTitle("Build Book") }
                }
                ForEach(results) { entry in
                    NavigationLink {
                        BuildEntryView(entry: entry)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.title).font(.headline)
                            Text("\(entry.category) · \(entry.pageLabel)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if results.isEmpty { Text("No matching products or ingredients.") }
            }
        }
        .navigationTitle("Build Book")
        .searchable(text: $query, prompt: "Product or ingredient")
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Menu {
                    Picker("Category", selection: $category) {
                        Text("All categories").tag("")
                        ForEach(["Fruit", "Vegetables", "Salads", "Guides"], id: \.self) { Text($0).tag($0) }
                    }
                } label: { Label("Category", systemImage: "line.3.horizontal.decrease.circle") }
            }
        }
        .task { load() }
    }
    private func load() {
        do { entries = try BuildBookLibrary.load(); failed = false } catch { failed = true }
    }
}
private struct BuildEntryView: View {
    let entry: BuildBookEntry
    @State private var showText = false
    var body: some View {
        VStack(spacing: 0) {
            Picker("View", selection: $showText) { Text("Original pages").tag(false); Text("Page text").tag(true) }
                .pickerStyle(.segmented).padding()
            if showText {
                ScrollView { Text(entry.text.isEmpty ? "This page contains diagrams. Open Original pages." : entry.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
            } else { BookPages(page: entry.pages.first ?? 1) }
        }
        .navigationTitle(entry.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
private struct BookPages: View {
    let page: Int
    var body: some View {
        if let url = BuildBookLibrary.pdfURL, let document = PDFDocument(url: url) {
            OriginalBookView(document: document, page: page).accessibilityIdentifier("build-book-pdf")
        } else { ContentUnavailableView("Book unavailable", systemImage: "book.closed") }
    }
}
#if os(iOS)
private struct OriginalBookView: UIViewRepresentable {
    let document: PDFDocument
    let page: Int
    func makeUIView(context: Context) -> PDFView { makeView() }
    func updateUIView(_ view: PDFView, context: Context) {}
    private func makeView() -> PDFView {
        let view = PositionedPDFView(); view.document = document; view.autoScales = true
        view.displayMode = .singlePageContinuous; view.displayDirection = .vertical
        view.targetPage = document.page(at: page - 1)
        return view
    }
}
#elseif os(macOS)
private struct OriginalBookView: NSViewRepresentable {
    let document: PDFDocument
    let page: Int
    func makeNSView(context: Context) -> PDFView {
        let view = PositionedPDFView(); view.document = document; view.autoScales = true
        view.displayMode = .singlePageContinuous; view.displayDirection = .vertical
        view.targetPage = document.page(at: page - 1)
        return view
    }
    func updateNSView(_ view: PDFView, context: Context) {}
}
#endif

// PDFKit can reset an early go(to:) while laying out a newly assigned document.
// Position once after the view has its real bounds, then leave scrolling/zoom alone.
private final class PositionedPDFView: PDFView {
    var targetPage: PDFPage?
    private var positioned = false
    #if os(iOS)
    override func layoutSubviews() {
        super.layoutSubviews()
        positionIfReady()
    }
    #elseif os(macOS)
    override func layout() {
        super.layout()
        positionIfReady()
    }
    #endif
    private func positionIfReady() {
        guard !positioned, bounds.width > 0, bounds.height > 0, let targetPage else { return }
        positioned = true
        DispatchQueue.main.async { [weak self] in self?.go(to: targetPage) }
    }
}
