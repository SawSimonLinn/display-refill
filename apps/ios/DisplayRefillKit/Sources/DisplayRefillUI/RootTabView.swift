import SwiftUI

/// Employee navigation shell: Check (store → display → capture/manual) and
/// History. Screens are empty states until features 04 and 07 supply data.
public struct RootTabView: View {
    private let onExit: () -> Void

    public init(onExit: @escaping () -> Void) {
        self.onExit = onExit
    }

    public var body: some View {
        TabView {
            NavigationStack {
                StoreListPlaceholderView()
                    .toolbar { exitButton }
            }
            .tabItem { Label("Check", systemImage: "checklist") }

            NavigationStack {
                ContentUnavailableView(
                    "No checks yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Confirmed checks will appear here.")
                )
                .navigationTitle("History")
                .toolbar { exitButton }
            }
            .tabItem { Label("History", systemImage: "clock") }
        }
        .safeAreaInset(edge: .top, spacing: 0) { PreviewBanner() }
    }

    private var exitButton: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Exit preview", action: onExit)
        }
    }
}

struct StoreListPlaceholderView: View {
    var body: some View {
        ContentUnavailableView(
            "No stores available",
            systemImage: "storefront",
            description: Text("After you sign in, choose a store and display here.")
        )
        .navigationTitle("Stores")
    }
}

struct PreviewBanner: View {
    var body: some View {
        Label("Preview — not signed in, no data", systemImage: "eye")
            .font(.footnote.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Theme.surface)
            .accessibilityAddTraits(.isHeader)
    }
}
