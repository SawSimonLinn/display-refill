import DisplayRefillCore
import SwiftUI

/// Employee shell after sign-in: Check (authorized stores) and History.
/// Display selection and checks arrive with features 04 and 07.
public struct SignedInView: View {
    let me: Me
    let onReload: () async -> Void
    let onSignOut: () async -> Void

    public init(me: Me, onReload: @escaping () async -> Void, onSignOut: @escaping () async -> Void) {
        self.me = me
        self.onReload = onReload
        self.onSignOut = onSignOut
    }

    public var body: some View {
        TabView {
            NavigationStack {
                StoreListView(stores: me.stores)
                    .refreshable { await onReload() }
                    .toolbar { accountMenu }
            }
            .tabItem { Label("Check", systemImage: "checklist") }

            NavigationStack {
                ContentUnavailableView(
                    "No checks yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Confirmed checks will appear here.")
                )
                .navigationTitle("History")
                .toolbar { accountMenu }
            }
            .tabItem { Label("History", systemImage: "clock") }
        }
    }

    private var accountMenu: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                if let email = me.email { Text(email) }
                Button("Sign out", role: .destructive) { Task { await onSignOut() } }
            } label: {
                Label("Account", systemImage: "person.crop.circle")
            }
        }
    }
}

/// Stores the server says this user may access; nothing else is shown.
struct StoreListView: View {
    let stores: [Me.Store]

    var body: some View {
        Group {
            if stores.isEmpty {
                ContentUnavailableView(
                    "No stores assigned",
                    systemImage: "storefront",
                    description: Text("Ask your manager or administrator to assign you to a store.")
                )
            } else {
                List(stores) { store in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.name).font(.headline)
                        Text("Store #\(store.storeNumber) · \(store.role.label)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .navigationTitle("Stores")
    }
}

/// Signed in, but no active membership (revoked or never assigned).
struct AccessRemovedView: View {
    let onRetry: () async -> Void
    let onSignOut: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label("No access", systemImage: "lock")
        } description: {
            Text("Your account no longer has access to any store. Contact your administrator.")
        } actions: {
            Button("Try again") { Task { await onRetry() } }
            Button("Sign out", role: .destructive) { Task { await onSignOut() } }
        }
    }
}
