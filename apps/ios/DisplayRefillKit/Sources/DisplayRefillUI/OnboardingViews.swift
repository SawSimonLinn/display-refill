import DisplayRefillCore
import SwiftUI

// Feature 16: create an account with an email code, enter the organization's access code,
// create or join a store by number, and (for a new store's manager) pick its display cases.

/// Email/password sign-up, then the 6-digit code Supabase emails. The code step never says
/// whether the email already had an account.
struct SignUpView: View {
    @Bindable var session: AppSession
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var code = ""
    @State private var awaitingCode = false
    @State private var resent = false

    private var passwordProblem: String? {
        if password.isEmpty { return nil }
        if password.count < 12 { return "Use at least 12 characters." }
        if !confirm.isEmpty && confirm != password { return "Passwords don't match." }
        return nil
    }
    private var canSubmit: Bool {
        !session.signUpBusy && !name.trimmingCharacters(in: .whitespaces).isEmpty && email.contains("@") && password.count >= 12 && password == confirm
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if awaitingCode { codeStep } else { formStep }
                if let error = session.signUpError {
                    Label(error, systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(Theme.destructive)
                }
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.page.ignoresSafeArea())
        .navigationTitle(awaitingCode ? "Check your email" : "Create account")
    }

    private var formStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Use your work email. After you confirm it, enter the access code from your manager.")
                .font(.subheadline).foregroundStyle(.secondary)
            TextField("Your name", text: $name).textContentType(.name).filledField()
            emailField.filledField()
            PasswordField(title: "Password (12+ characters)", text: $password, isNew: true)
            PasswordField(title: "Confirm password", text: $confirm, isNew: true)
            if let passwordProblem {
                Text(passwordProblem).font(.footnote).foregroundStyle(Theme.verify)
            }
            Button {
                Task { if await session.signUp(email: email, password: password, name: name) { awaitingCode = true } }
            } label: {
                if session.signUpBusy { HStack { ProgressView().tint(Theme.onAction); Text("Creating…") } } else { Text("Create account") }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(!canSubmit).padding(.top, 8)
        }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("We sent a 6-digit code to \(email). Enter it to finish. If this email already has an account, sign in instead.")
                .font(.subheadline).foregroundStyle(.secondary)
            codeField.filledField()
            Button {
                Task { await session.confirmSignUp(email: email, code: code) }
            } label: {
                if session.signUpBusy { HStack { ProgressView().tint(Theme.onAction); Text("Confirming…") } } else { Text("Confirm") }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(session.signUpBusy || code.filter(\.isNumber).count != 6)
            Button(resent ? "New code sent" : "Send a new code") { Task { resent = await session.resendSignUpCode(email: email) } }
                .frame(maxWidth: .infinity, minHeight: 44).disabled(session.signUpBusy || resent)
            Button("Change email") { awaitingCode = false; code = ""; resent = false }
                .font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
        }
    }

    @ViewBuilder private var emailField: some View {
        #if os(iOS)
        TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        TextField("Email", text: $email).textContentType(.username).autocorrectionDisabled()
        #endif
    }

    @ViewBuilder private var codeField: some View {
        #if os(iOS)
        TextField("6-digit code", text: $code).textContentType(.oneTimeCode).keyboardType(.numberPad)
            .font(.title2.monospacedDigit()).accessibilityIdentifier("signup-code")
        #else
        TextField("6-digit code", text: $code).font(.title2.monospacedDigit())
        #endif
    }
}

/// Access code → store → display cases. Every step is re-checked by the server; `onDone`
/// reloads the account, which leaves onboarding once the server says it is complete.
struct OnboardingView: View {
    let status: OnboardingStatus
    let api: any OnboardingAPI
    let onDone: () async -> Void
    let onSignOut: () async -> Void

    private enum Step: Equatable { case accessCode, store, displayCases(storeID: String, storeName: String) }
    @State private var step: Step
    @State private var code = ""
    @State private var organization: String?
    @State private var creating = false
    @State private var number = ""
    @State private var storeName = ""
    @State private var timezone = TimeZone.current.identifier
    @State private var busy = false
    @State private var error: String?
    @State private var joinedMessage: String?

    init(status: OnboardingStatus, api: any OnboardingAPI, onDone: @escaping () async -> Void, onSignOut: @escaping () async -> Void) {
        self.status = status; self.api = api; self.onDone = onDone; self.onSignOut = onSignOut
        _step = State(initialValue: status.state == .accessCode ? .accessCode : .store)
        _organization = State(initialValue: status.organization?.name)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch step {
                    case .accessCode: accessCodeStep
                    case .store: storeStep
                    case .displayCases(let storeID, let name):
                        DisplayCasesEditor(storeID: storeID, api: api, intro: "Choose the display cases \(name) has. Staff will count only these. You can change this any time from Stock Check.", saveLabel: "Finish setup") {
                            Task { await onDone() }
                        }
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(Theme.destructive)
                    }
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.page.ignoresSafeArea())
            .navigationTitle(title)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Sign out") { Task { await onSignOut() } } } }
        }
    }

    private var title: String {
        switch step {
        case .accessCode: "Join your team"
        case .store: "Your store"
        case .displayCases: "Display cases"
        }
    }

    private var accessCodeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enter the access code your manager or administrator gave you.").font(.subheadline).foregroundStyle(.secondary)
            codeField.filledField()
            Button("Join") { Task { await join() } }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || !AccessCode.isComplete(code))
        }
    }

    private var storeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let organization { Text("You joined \(organization).").font(.headline) }
            if let joinedMessage { Notice(text: joinedMessage, systemImage: "checkmark.circle", tint: Theme.confirmed) }
            Picker("Store", selection: $creating) {
                Text("Join my store").tag(false)
                Text("Set up a new store").tag(true)
            }.pickerStyle(.segmented)
            Text(creating ? "You will be this store's manager. Coworkers join with the same store number." : "Enter your store's number. Your manager sets the store up first.")
                .font(.subheadline).foregroundStyle(.secondary)
            numberField.filledField()
            if creating {
                TextField("Store name", text: $storeName).filledField()
                Picker("Time zone", selection: $timezone) {
                    ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) }
                }
                #if os(iOS)
                .pickerStyle(.navigationLink)
                #endif
            }
            Button(creating ? "Create store" : "Join store") { Task { await joinStore() } }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || number.trimmingCharacters(in: .whitespaces).isEmpty || (creating && storeName.trimmingCharacters(in: .whitespaces).isEmpty))
        }
    }

    /// Shows XXXX-XXXX as the person types; a typed or pasted dash is ignored.
    private var codeField: some View {
        accessCodeTextField
            .font(.title2.monospaced())
            .onChange(of: code) { _, new in
                let formatted = AccessCode.formatted(new)
                if formatted != new { code = formatted }
            }
            .onSubmit { if AccessCode.isComplete(code), !busy { Task { await join() } } }
    }

    @ViewBuilder private var accessCodeTextField: some View {
        #if os(iOS)
        TextField("XXXX-XXXX", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled()
            .keyboardType(.asciiCapable).submitLabel(.join).accessibilityIdentifier("access-code")
            .accessibilityLabel("Access code")
        #else
        TextField("XXXX-XXXX", text: $code).accessibilityLabel("Access code")
        #endif
    }

    @ViewBuilder private var numberField: some View {
        #if os(iOS)
        TextField("Store number", text: $number).textInputAutocapitalization(.characters).autocorrectionDisabled()
        #else
        TextField("Store number", text: $number)
        #endif
    }

    private func join() async {
        busy = true; error = nil
        defer { busy = false }
        do throws(APIClientError) {
            let result = try await api.joinOrganization(accessCode: AccessCode.characters(code))
            organization = result.organization?.name
            if result.state == .complete { await onDone() } else { step = .store }
        } catch {
            self.error = Self.message(error, invalid: "That access code is not valid. Ask your manager for the current code.")
        }
    }

    private func joinStore() async {
        busy = true; error = nil
        defer { busy = false }
        let trimmed = number.trimmingCharacters(in: .whitespaces)
        do throws(APIClientError) {
            let result = try await api.joinStore(number: trimmed, name: creating ? storeName.trimmingCharacters(in: .whitespaces) : nil, timezone: creating ? timezone : nil)
            if result.created {
                step = .displayCases(storeID: result.store.store_id, storeName: result.store.name)
            } else {
                if creating { joinedMessage = "Store #\(result.store.store_number) already exists, so you joined \(result.store.name)." }
                await onDone()
            }
        } catch {
            self.error = Self.message(error, invalid: creating
                ? "Check the store name and time zone, then try again."
                : "No store has that number yet. Check it, or choose “Set up a new store”.")
        }
    }

    static func message(_ error: APIClientError, invalid: String) -> String {
        switch error {
        case .server(_, .validationFailed, let message, _):
            // Specific server reasons (archived store, another organization) are shown as sent.
            return message == "The request contains invalid values." ? invalid : message
        case .server(_, .rateLimited, _, _): return "Too many attempts. Wait a few minutes and try again."
        case .server(_, .forbidden, _, _): return "Your access to this organization was removed. Ask an administrator."
        case .transport: return "Can't reach the server. Check your connection and retry."
        default: return "Something went wrong. Try again shortly."
        }
    }
}

/// Toggles the store's display case types and saves them (managers). Used in onboarding and Profile.
struct DisplayCasesEditor: View {
    let storeID: String
    let api: any OnboardingAPI
    var intro: String = "Staff count only the display cases you choose. Removing one keeps its history."
    var saveLabel: String = "Save display cases"
    var onSaved: () -> Void = {}

    @State private var choices: [DisplayCaseChoice] = []
    @State private var chosen: Set<String> = []
    /// Families shown open; all start collapsed so the list fits on one screen.
    @State private var expanded: Set<String> = []
    @State private var canManage = false
    @State private var loading = true
    @State private var busy = false
    @State private var error: String?
    @State private var saved = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(intro).font(.subheadline).foregroundStyle(.secondary)
            if loading { ProgressView("Loading display cases") }
            if !loading && !choices.isEmpty {
                Text("\(chosen.count) of \(choices.count) selected").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            ForEach(StoreDisplayCases.grouped(choices), id: \.family) { group in
                let open = expanded.contains(group.family)
                Button {
                    withAnimation(.snappy) { if open { expanded.remove(group.family) } else { expanded.insert(group.family) } }
                } label: {
                    HStack {
                        Eyebrow(group.family == "Other" ? "Fruit & Veg Combo" : group.family)
                        Spacer()
                        Text("\(group.choices.filter { chosen.contains($0.id) }.count) of \(group.choices.count)")
                            .font(.footnote).foregroundStyle(.secondary)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                            .rotationEffect(.degrees(open ? 90 : 0))
                    }
                    .padding(.top, 6).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isHeader)
                .accessibilityValue(open ? "Expanded" : "Collapsed")
                if open { ForEach(group.choices) { choice in
                    Toggle(choice.name, isOn: Binding(
                        get: { chosen.contains(choice.id) },
                        set: { on in saved = false; if on { chosen.insert(choice.id) } else { chosen.remove(choice.id) } }
                    ))
                    .disabled(!canManage || busy)
                    .card(padding: 14)
                } }
            }
            if !loading && !canManage {
                Text("Only the store's manager can change display cases.").font(.footnote).foregroundStyle(.secondary)
            }
            if canManage {
                Button(saved ? "Saved" : saveLabel) { Task { await save() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || chosen.isEmpty || saved)
            }
            if let error { Label(error, systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(Theme.destructive) }
        }
        .task { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do throws(APIClientError) {
            apply(try await api.storeDisplayCases(storeID: storeID))
        } catch {
            self.error = OnboardingView.message(error, invalid: "Couldn't load display cases.")
        }
    }

    private func save() async {
        busy = true; error = nil
        defer { busy = false }
        do throws(APIClientError) {
            // Keep the server's order of types.
            apply(try await api.setStoreDisplayCases(storeID: storeID, typeIDs: choices.map(\.id).filter(chosen.contains)))
            saved = true
            onSaved()
        } catch {
            self.error = OnboardingView.message(error, invalid: "Choose at least one display case.")
        }
    }

    private func apply(_ cases: StoreDisplayCases) {
        choices = cases.sections
        chosen = Set(cases.sections.filter(\.selected).map(\.id))
        canManage = cases.can_manage
    }
}

/// Profile → store → Display cases (store managers and admins).
struct DisplayCasesView: View {
    let store: Me.Store
    let api: any OnboardingAPI
    var body: some View {
        ScrollView {
            DisplayCasesEditor(storeID: store.id.uuidString.lowercased(), api: api).padding(20)
        }
        .pageBackground()
        .navigationTitle("Display cases")
    }
}
