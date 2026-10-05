import DisplayRefillCore
import SwiftUI

/// Assigned stores, server history of those stores (Feature 11) and device-saved scan links.
public struct SignedInView: View {
    let me: Me
    let api: any ManualScanAPI
    let onReload: () async -> Void
    let onSignOut: () async -> Void

    public init(me: Me, api: any ManualScanAPI, onReload: @escaping () async -> Void, onSignOut: @escaping () async -> Void) {
        self.me = me
        self.api = api
        self.onReload = onReload
        self.onSignOut = onSignOut
    }

    public var body: some View {
        TabView {
            NavigationStack {
                Group {
                    if let productionAPI = api as? any ProductionAPI {
                        ProductionTodayView(stores: me.stores, api: productionAPI, userID: me.userID.uuidString)
                    } else {
                        StoreListView(stores: me.stores, api: api, userID: me.userID.uuidString)
                    }
                }
                .toolbar { accountMenu }
            }
            .tabItem { Label("Stock Check", systemImage: "checklist") }

            if let prepAPI = api as? any PrepAPI {
                NavigationStack {
                    PrepListView(stores: me.stores, api: prepAPI, userID: me.userID.uuidString)
                        .toolbar { accountMenu }
                }.tabItem { Label("Prep List", systemImage: "shippingbox") }
            }

            NavigationStack {
                BuildBookView().toolbar { accountMenu }
            }.tabItem { Label("Build Book", systemImage: "book") }

            if let historyAPI = api as? any ScanHistoryAPI {
                NavigationStack {
                    HistoryView(stores: me.stores, api: historyAPI, userID: me.userID.uuidString)
                        .toolbar { accountMenu }
                }
                .tabItem { Label("History", systemImage: "list.bullet.rectangle") }
            }

            if let operationsAPI = api as? any OperationsAPI {
                NavigationStack {
                    WasteLogView(stores: me.stores, api: operationsAPI, userID: me.userID.uuidString)
                        .toolbar { accountMenu }
                }.tabItem { Label("Waste Log", systemImage: "trash") }
            }

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
    let api: any ManualScanAPI
    let userID: String

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
                    NavigationLink {
                        DisplaySelectionView(store: store, api: api, userID: userID)
                    } label: {
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
