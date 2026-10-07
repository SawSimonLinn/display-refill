import DisplayRefillCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// First production version: manual stock checks, prep, build book and waste,
/// plus a Profile tab for stores, settings, help and account.
public struct SignedInView: View {
    let me: Me
    let api: any ManualScanAPI
    let client: (any APIClient)?
    let onReload: () async -> Void
    let onSignOut: () async -> Void

    private enum Tab: Hashable { case stock, prep, book, waste, profile }
    @State private var tab: Tab = .stock
    @AppStorage(AppPreferences.appearanceKey) private var appearance = AppearanceChoice.system.rawValue
    @AppStorage(AppPreferences.keepAwakeKey) private var keepAwake = false
    @Environment(\.scenePhase) private var scenePhase

    public init(me: Me, api: any ManualScanAPI, client: (any APIClient)? = nil, onReload: @escaping () async -> Void, onSignOut: @escaping () async -> Void) {
        self.me = me
        self.api = api
        self.client = client
        self.onReload = onReload
        self.onSignOut = onSignOut
    }

    public var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                Group {
                    if let productionAPI = api as? any ProductionAPI {
                        ProductionTodayView(stores: me.stores, api: productionAPI, userID: me.userID.uuidString)
                    } else {
                        ContentUnavailableView("Manual stock check unavailable", systemImage: "checklist", description: Text("Update the app and try again."))
                    }
                }
                .toolbar { accountMenu }
            }
            .tabItem { Label("Stock Check", systemImage: "checklist") }
            .tag(Tab.stock)

            if let prepAPI = api as? any PrepAPI {
                NavigationStack {
                    PrepListView(stores: me.stores, api: prepAPI, userID: me.userID.uuidString)
                        .toolbar { accountMenu }
                }
                .tabItem { Label("Prep List", systemImage: "shippingbox") }
                .tag(Tab.prep)
            }

            NavigationStack {
                BuildBookView().toolbar { accountMenu }
            }
            .tabItem { Label("Build Book", systemImage: "book") }
            .tag(Tab.book)

            if let operationsAPI = api as? any OperationsAPI {
                NavigationStack {
                    WasteLogView(stores: me.stores, api: operationsAPI, stock: api as? any PrepAPI, userID: me.userID.uuidString)
                        .toolbar { accountMenu }
                }
                .tabItem { Label("Waste Log", systemImage: "trash") }
                .tag(Tab.waste)
            }

            NavigationStack {
                ProfileView(me: me, client: client, onSignOut: onSignOut)
                    .refreshable { await onReload() }
            }
            .tabItem { Label("Profile", systemImage: "person.crop.circle") }
            .tag(Tab.profile)
        }
        .preferredColorScheme(AppearanceChoice(rawValue: appearance)?.colorScheme)
        .onAppear(perform: applyKeepAwake)
        .onChange(of: keepAwake) { applyKeepAwake() }
        .onChange(of: scenePhase) { applyKeepAwake() }
        .onDisappear { setIdleTimerDisabled(false) }
    }

    /// Quick access from any work tab; the Profile tab has the full account page.
    private var accountMenu: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                // Menus ignore lineLimit, so long names and emails are shortened here to stay on one line.
                Section {
                    Text(Self.oneLine(me.displayName.isEmpty ? (me.email ?? "Signed in") : me.displayName))
                    if let email = me.email, !me.displayName.isEmpty { Text(Self.oneLine(email)) }
                }
                Button { tab = .profile } label: { Label("Profile & settings", systemImage: "gearshape") }
                Button("Sign out", role: .destructive) { Task { await onSignOut() } }
            } label: {
                Label("Account", systemImage: "person.circle")
            }
        }
    }

    /// "averylongname@example.com" → "averylo…@example.com"; keeps the domain when it fits.
    static func oneLine(_ text: String, limit: Int = 22) -> String {
        guard text.count > limit else { return text }
        if let at = text.lastIndex(of: "@") {
            let domain = text[at...]
            let keep = limit - domain.count - 1
            if keep >= 3 { return text.prefix(keep) + "…" + domain }
        }
        return text.prefix(limit - 1) + "…"
    }

    private func applyKeepAwake() {
        setIdleTimerDisabled(keepAwake && scenePhase == .active)
    }

    private func setIdleTimerDisabled(_ disabled: Bool) {
        #if canImport(UIKit)
        UIApplication.shared.isIdleTimerDisabled = disabled
        #endif
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
