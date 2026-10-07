import DisplayRefillCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Preferences

/// Per-device preferences. Only non-sensitive choices live here; the session
/// stays in the Keychain.
enum AppPreferences {
    static let appearanceKey = "settings.appearance"
    static let keepAwakeKey = "settings.keepScreenAwake"

    /// The same key the work tabs use to remember the last store.
    static func defaultStoreKey(userID: String) -> String { "production.store.\(userID)" }
}

enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: "Match iPhone"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Me {
    /// Highest store role, used as the headline role on the profile.
    var headlineRole: StoreAccessRole? {
        if stores.contains(where: { $0.role == .admin }) { return .admin }
        if stores.contains(where: { $0.role == .manager }) { return .manager }
        return stores.first?.role
    }

    var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        let letters = parts.compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? String(email?.first ?? "?").uppercased() : letters.uppercased()
    }
}

// MARK: - Profile tab

struct ProfileView: View {
    let me: Me
    let client: (any APIClient)?
    let onSignOut: () async -> Void

    @State private var confirmSignOut = false
    @State private var confirmReset = false
    @State private var resetState: ResetState = .idle

    enum ResetState: Equatable { case idle, sending, sent, failed(String) }

    var body: some View {
        List {
            Section {
                ProfileHeader(me: me)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Section("Work") {
                NavigationLink {
                    MyStoresView(me: me)
                } label: {
                    row("My stores", systemImage: "storefront", detail: "\(me.stores.count)")
                }
                if !me.organizations.isEmpty {
                    NavigationLink {
                        OrganizationsView(me: me)
                    } label: {
                        row("Organization", systemImage: "building.2", detail: me.organizations.count == 1 ? me.organizations[0].name : "\(me.organizations.count)")
                    }
                }
                if me.capabilities.dashboard {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Manager dashboard")
                            Text("Layouts, members and reports are managed on the web.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "rectangle.grid.2x2") }
                    .accessibilityElement(children: .combine)
                }
            }

            Section("App") {
                NavigationLink {
                    SettingsView(me: me)
                } label: { row("Settings", systemImage: "gearshape") }
                NavigationLink {
                    HelpView()
                } label: { row("Help & tips", systemImage: "questionmark.circle") }
                NavigationLink {
                    AboutView(me: me, client: client)
                } label: { row("About this app", systemImage: "info.circle") }
            }

            Section {
                if client != nil, me.email != nil {
                    Button {
                        confirmReset = true
                    } label: {
                        row("Change password", systemImage: "key")
                    }
                    .foregroundStyle(Theme.action)
                    .disabled(resetState == .sending)
                }
                Button(role: .destructive) {
                    confirmSignOut = true
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } header: {
                Text("Account")
            } footer: {
                switch resetState {
                case .idle: EmptyView()
                case .sending: Text("Sending reset email…")
                case .sent: Label("Reset link sent. Check your inbox for a link to choose a new password.", systemImage: "checkmark.circle")
                case .failed(let message): Label(message, systemImage: "exclamationmark.circle")
                }
            }
        }
        .pageBackground()
        .navigationTitle("Profile")
        .confirmationDialog("Sign out of DisplayRefill? Save any open counts first.", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await onSignOut() } }
        }
        .confirmationDialog("Email a password reset link to your sign-in address?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Send reset link") { Task { await sendReset() } }
        }
    }

    private func row(_ title: String, systemImage: String, detail: String? = nil) -> some View {
        LabeledContent {
            if let detail { Text(detail).monospacedDigit() }
        } label: {
            Label(title, systemImage: systemImage)
        }
    }

    private func sendReset() async {
        guard let client, let email = me.email else { return }
        resetState = .sending
        do throws(APIClientError) {
            _ = try await client.requestPasswordReset(email: email)
            resetState = .sent
        } catch {
            switch error {
            case .transport: resetState = .failed("Can't reach the server. Check your connection and retry.")
            case .server(status: 429, _, _, _): resetState = .failed("Too many requests. Wait a few minutes and try again.")
            default: resetState = .failed("Couldn't send the email. Try again shortly.")
            }
        }
    }
}

private struct ProfileHeader: View {
    let me: Me

    var body: some View {
        HStack(spacing: 16) {
            Text(me.initials)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.onAction)
                .frame(width: 64, height: 64)
                .background(Theme.action, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(me.displayName.isEmpty ? (me.email ?? "Signed in") : me.displayName)
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(me.displayName.isEmpty ? .middle : .tail)
                if let email = me.email, !me.displayName.isEmpty {
                    Text(email).font(.subheadline).foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.middle)
                }
                HStack(spacing: 6) {
                    if let role = me.headlineRole { Pill(text: role.label, systemImage: "person.badge.shield.checkmark", filled: true) }
                    if let org = me.organizations.first { Pill(text: org.name) }
                }
                .padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .card()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stores

struct MyStoresView: View {
    let me: Me
    @AppStorage private var defaultStore: String

    init(me: Me) {
        self.me = me
        _defaultStore = AppStorage(wrappedValue: "", AppPreferences.defaultStoreKey(userID: me.userID.uuidString))
    }

    var body: some View {
        Group {
            if me.stores.isEmpty {
                ContentUnavailableView("No stores assigned", systemImage: "storefront", description: Text("Ask your manager or administrator to assign you to a store."))
            } else {
                List {
                    Section {
                        ForEach(me.stores) { store in
                            NavigationLink {
                                StoreDetailView(store: store, userID: me.userID.uuidString)
                            } label: {
                                StoreRow(store: store, isDefault: store.id.uuidString == defaultStore)
                            }
                        }
                    } footer: {
                        Text("Stores come from your memberships. Ask an administrator to add or remove one.")
                    }
                }
            }
        }
        .pageBackground()
        .navigationTitle("My stores")
    }
}

private struct StoreRow: View {
    let store: Me.Store
    let isDefault: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(store.name).font(.headline)
                if isDefault {
                    Image(systemName: "star.fill").imageScale(.small).foregroundStyle(.secondary)
                        .accessibilityLabel("Default store")
                }
            }
            Text("Store #\(store.storeNumber) · \(store.role.label)")
                .font(.subheadline).foregroundStyle(.secondary)
            StoreLocalTime(timezone: store.timezone)
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Live store-local clock, so staff working across zones see the store's day.
private struct StoreLocalTime: View {
    let timezone: String

    var body: some View {
        TimelineView(.everyMinute) { context in
            if let zone = TimeZone(identifier: timezone) {
                Text("Local time \(context.date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, timeZone: zone)))")
                    .monospacedDigit()
            } else {
                Text(timezone)
            }
        }
    }
}

struct StoreDetailView: View {
    let store: Me.Store
    @AppStorage private var defaultStore: String

    init(store: Me.Store, userID: String) {
        self.store = store
        _defaultStore = AppStorage(wrappedValue: "", AppPreferences.defaultStoreKey(userID: userID))
    }

    private var isDefault: Bool { defaultStore == store.id.uuidString }

    var body: some View {
        List {
            Section("Store") {
                LabeledContent("Name", value: store.name)
                LabeledContent("Store number", value: store.storeNumber).monospacedDigit()
                LabeledContent("Time zone", value: store.timezone)
                LabeledContent("Local time") { StoreLocalTime(timezone: store.timezone) }
            }
            Section {
                LabeledContent("Your role", value: store.role.label)
                ForEach(permissions, id: \.self) { item in
                    Label(item, systemImage: "checkmark").font(.subheadline)
                }
            } header: {
                Text("Your access")
            } footer: {
                Text("Roles are set by an administrator on the web.")
            }
            Section {
                Button {
                    defaultStore = isDefault ? "" : store.id.uuidString
                } label: {
                    Label(isDefault ? "Default store" : "Make default store", systemImage: isDefault ? "star.fill" : "star")
                }
                .foregroundStyle(Theme.action)
                .accessibilityValue(isDefault ? "On" : "Off")
            } footer: {
                Text("Stock Check, Prep List and Waste Log open on your default store.")
            }
        }
        .pageBackground()
        .navigationTitle(store.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var permissions: [String] {
        let employee = ["Count stock and record preparation", "Log waste", "Read the build book"]
        switch store.role {
        case .employee: return employee
        case .manager, .admin: return employee + ["Review store reports on the web dashboard"]
        case .unknown: return ["Limited access. Update the app to see more."]
        }
    }
}

struct OrganizationsView: View {
    let me: Me

    var body: some View {
        List(me.organizations, id: \.organizationID) { org in
            VStack(alignment: .leading, spacing: 4) {
                Text(org.name).font(.headline)
                Text(org.role == .admin ? "Organization admin" : "Member")
                    .font(.subheadline).foregroundStyle(.secondary)
                let count = me.stores.filter { $0.organizationID == org.organizationID }.count
                Text("\(count) store\(count == 1 ? "" : "s") assigned to you")
                    .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)
        }
        .pageBackground()
        .navigationTitle("Organization")
    }
}

// MARK: - Settings

struct SettingsView: View {
    let me: Me
    @AppStorage(AppPreferences.appearanceKey) private var appearance = AppearanceChoice.system.rawValue
    @AppStorage(AppPreferences.keepAwakeKey) private var keepAwake = false
    @AppStorage private var defaultStore: String

    init(me: Me) {
        self.me = me
        _defaultStore = AppStorage(wrappedValue: "", AppPreferences.defaultStoreKey(userID: me.userID.uuidString))
    }

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: $appearance) {
                    ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0.rawValue) }
                }
            } header: {
                Text("Display")
            } footer: {
                Text("Light can be easier to read under bright store lighting.")
            }

            Section {
                Toggle(isOn: $keepAwake) {
                    Label("Keep screen on", systemImage: "sun.max")
                }
            } header: {
                Text("While working")
            } footer: {
                Text("Stops the phone locking while this app is open, so a count isn't interrupted. Uses more battery.")
            }

            if me.stores.count > 1 {
                Section {
                    Picker("Default store", selection: $defaultStore) {
                        Text("Last used").tag("")
                        ForEach(me.stores) { Text($0.name).tag($0.id.uuidString) }
                    }
                } header: {
                    Text("Stores")
                } footer: {
                    Text("Switching store from a tab also updates this.")
                }
            }

            #if canImport(UIKit)
            Section {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    Link(destination: url) {
                        LabeledContent {
                            Image(systemName: "arrow.up.forward.app").foregroundStyle(.secondary)
                        } label: {
                            Label("Camera & photo access", systemImage: "camera")
                        }
                    }
                    .foregroundStyle(Theme.action)
                }
            } header: {
                Text("Permissions")
            } footer: {
                Text("Opens iOS Settings for this app.")
            }
            #endif

            Section("Data on this phone") {
                Label("Your sign-in is kept in the iPhone Keychain.", systemImage: "lock")
                Label("Photos and cached data are removed when you sign out.", systemImage: "trash")
                Label("Unsaved entries stay on this phone until they're saved or discarded.", systemImage: "iphone")
            }
            .font(.subheadline)
        }
        .pageBackground()
        .navigationTitle("Settings")
    }
}

// MARK: - Help

struct HelpView: View {
    private struct Topic: Identifiable {
        let id: String
        let systemImage: String
        let tips: [String]
    }

    private let topics: [Topic] = [
        Topic(id: "Stock Check", systemImage: "checklist", tips: [
            "Count every location of a product, including the prep room.",
            "Enter 0 if a location is empty. Leave items you didn't count blank.",
            "Finish each section to see what needs making.",
            "After stock moves or sells, recount every location of that product.",
        ]),
        Topic(id: "Prep List", systemImage: "shippingbox", tips: [
            "Shows what to make from your latest counts. Uncounted sections are excluded.",
            "Record containers as you finish them so other phones see the change.",
            "Use Undo straight away if you recorded the wrong amount.",
        ]),
        Topic(id: "Build Book", systemImage: "book", tips: [
            "Search by product or ingredient to open the build page.",
            "The build book is stored in the app and works without a connection.",
        ]),
        Topic(id: "Waste Log", systemImage: "trash", tips: [
            "Log containers when you throw them away, with a reason.",
            "After discarding stock, update HAVE in Stock Check.",
        ]),
    ]

    private let problems: [(String, String)] = [
        ("No connection", "Connect to save counts. Entries stay on this phone until they're saved; they don't sync automatically."),
        ("\"Changed on another device\"", "Someone saved the same check. Reload the latest version before saving yours."),
        ("A save keeps failing", "Keep the screen open, check your connection and tap Retry. Don't record the same containers on another phone."),
        ("Wrong store or missing store", "Your manager or administrator controls store access."),
    ]

    var body: some View {
        List {
            Section("How it works") {
                ForEach(topics) { topic in
                    DisclosureGroup {
                        ForEach(topic.tips, id: \.self) { tip in
                            Label(tip, systemImage: "circle.fill")
                                .labelStyle(BulletLabelStyle())
                                .font(.subheadline)
                        }
                    } label: {
                        Label(topic.id, systemImage: topic.systemImage)
                    }
                }
            }
            Section("Troubleshooting") {
                ForEach(problems, id: \.0) { title, answer in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).font(.subheadline.weight(.semibold))
                        Text(answer).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }
            Section {
                Label("Still stuck? Ask your store manager. They can contact your administrator.", systemImage: "person.2")
                    .font(.subheadline)
            }
        }
        .pageBackground()
        .navigationTitle("Help & tips")
    }
}

private struct BulletLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            configuration.icon.font(.system(size: 5)).foregroundStyle(.secondary).accessibilityHidden(true)
            configuration.title
        }
    }
}

// MARK: - About

struct AboutView: View {
    let me: Me
    let client: (any APIClient)?
    @State private var health: HealthCheckModel?
    @State private var copied = false

    private var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? "–"
        let build = info["CFBundleVersion"] as? String ?? "–"
        return "\(short) (\(build))"
    }

    private var system: String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if canImport(UIKit)
        let name = "iOS"
        #else
        let name = "macOS"
        #endif
        return "\(name) \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
    }

    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "square.stack.3d.up.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(Theme.onAction)
                        .frame(width: 76, height: 76)
                        .background(Theme.action, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .accessibilityHidden(true)
                    Text("DisplayRefill").font(.title3.weight(.semibold))
                    Text("Stock, prep and waste for store teams").font(.subheadline).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }

            Section("App") {
                LabeledContent("Version", value: version).monospacedDigit()
                LabeledContent("System", value: system).monospacedDigit()
            }

            if let health {
                Section {
                    switch health.state {
                    case .idle, .loading:
                        LabeledContent("Server") { ProgressView() }
                    case .reachable(let status):
                        LabeledContent("Server") { Label("Connected", systemImage: "checkmark.circle").foregroundStyle(Theme.confirmed) }
                        LabeledContent("Status", value: status.status.capitalized)
                        LabeledContent("API version", value: status.apiVersion).monospacedDigit()
                    case .failed(let message):
                        LabeledContent("Server") { Label("Not reachable", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.verify) }
                        Text(message).font(.footnote).foregroundStyle(.secondary)
                    }
                    Button("Check again") { Task { await health.check() } }
                        .disabled(health.state == .loading)
                } header: {
                    Text("Connection")
                }
            }

            Section {
                Button {
                    copyDiagnostics()
                } label: {
                    Label(copied ? "Copied" : "Copy support details", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .foregroundStyle(Theme.action)
            } footer: {
                Text("App version, system and your account ID, to paste into a message to your administrator. No passwords or counts are included.")
            }
        }
        .pageBackground()
        .navigationTitle("About")
        .task {
            guard let client, health == nil else { return }
            let model = HealthCheckModel(client: client)
            health = model
            await model.check()
        }
    }

    private func copyDiagnostics() {
        let text = """
        DisplayRefill \(version)
        \(system)
        Account \(me.userID.uuidString.lowercased())
        Stores \(me.stores.map(\.storeNumber).joined(separator: ", "))
        """
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #endif
        copied = true
    }
}
