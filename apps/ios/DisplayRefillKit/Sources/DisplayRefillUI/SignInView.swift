import DisplayRefillCore
import SwiftUI

/// Email/password sign-in. Accounts come from admin invitations; there is no
/// sign-up. Password reset emails link to the web page that sets a new password.
public struct SignInView: View {
    @Bindable private var session: AppSession
    @State private var health: HealthCheckModel
    @State private var email = ""
    @State private var password = ""
    @State private var showingReset = false
    private let client: any APIClient

    public init(session: AppSession, client: any APIClient) {
        self.session = session
        self.client = client
        _health = State(initialValue: HealthCheckModel(client: client))
    }

    private var busy: Bool { session.phase == .signingIn }
    private var notice: String? {
        if case .signedOut(let notice) = session.phase { return notice }
        return nil
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    header
                    if let notice {
                        Notice(text: notice, systemImage: "info.circle", tint: .secondary)
                    }
                    VStack(spacing: 12) {
                        emailField.filledField()
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .submitLabel(.go)
                            .onSubmit(submit)
                            .filledField()
                        if let error = session.signInError {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(.subheadline)
                                .foregroundStyle(Theme.destructive)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    VStack(spacing: 8) {
                        Button(action: submit) {
                            if busy {
                                HStack { ProgressView().tint(Theme.onAction); Text("Signing in…") }
                            } else {
                                Text("Sign in")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(busy || email.isEmpty || password.isEmpty)
                        Button("Forgot password?") { showingReset = true }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(minHeight: 44)
                            .disabled(busy)
                    }
                    serverStatus
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.page.ignoresSafeArea())
            .task { await health.check() }
            .sheet(isPresented: $showingReset) {
                ForgotPasswordView(client: client, initialEmail: email)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 20) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    ForEach(["stock", "prep", "build book", "waste"], id: \.self) { Pill(text: $0) }
                }
                Color.clear.frame(height: 0)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text("refill")
                    .font(.system(size: 64, weight: .black))
                    .tracking(-2)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityLabel("Display Refill")
                Text("Stock, prep and waste in one place.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 40)
    }

    private var serverStatus: some View {
        HStack(spacing: 12) {
            ServerStatusRow(state: health.state)
                .font(.footnote)
            Spacer(minLength: 8)
            Button("Check again") { Task { await health.check() } }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.action)
                .frame(minHeight: 44)
                .disabled(health.state == .loading)
        }
        .padding(.horizontal, 16)
        .background(Theme.surface, in: Capsule())
    }

    @ViewBuilder private var emailField: some View {
        #if os(iOS)
        TextField("Email", text: $email)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        TextField("Email", text: $email)
            .textContentType(.username)
            .autocorrectionDisabled()
        #endif
    }

    private func submit() {
        guard !busy, !email.isEmpty, !password.isEmpty else { return }
        let (email, password) = (email, password)
        self.password = ""
        Task { await session.signIn(email: email, password: password) }
    }
}

struct ServerStatusRow: View {
    let state: HealthCheckModel.State

    var body: some View {
        switch state {
        case .idle, .loading:
            HStack {
                ProgressView()
                Text("Checking server…")
            }
            .accessibilityElement(children: .combine)
        case .reachable(let health):
            Label("Reachable · API \(health.apiVersion)", systemImage: "checkmark.circle")
                .foregroundStyle(Theme.confirmed)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(Theme.verify)
        }
    }
}

/// Requests a reset email. The answer is the same whether or not the account
/// exists; the email opens a web page where the new password is chosen.
struct ForgotPasswordView: View {
    let client: any APIClient
    @State var email: String
    @State private var state: ResetState = .idle
    @Environment(\.dismiss) private var dismiss

    enum ResetState: Equatable { case idle, sending, sent, failed(String) }

    init(client: any APIClient, initialEmail: String) {
        self.client = client
        _email = State(initialValue: initialEmail)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("The link opens a web page where you choose a new password. Then sign in here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .filledField()
                    Button("Send reset link") { Task { await send() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(state == .sending || email.isEmpty)
                    switch state {
                    case .sent:
                        Notice(text: "If an account exists for that address, a reset link is on its way.", systemImage: "envelope", tint: Theme.confirmed)
                    case .failed(let message):
                        Notice(text: message, systemImage: "exclamationmark.triangle", tint: Theme.destructive)
                    case .idle, .sending:
                        EmptyView()
                    }
                }
                .padding(24)
            }
            .background(Theme.page.ignoresSafeArea())
            .navigationTitle("Reset password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
    }

    private func send() async {
        state = .sending
        do throws(APIClientError) {
            _ = try await client.requestPasswordReset(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            state = .sent
        } catch {
            switch error {
            case .server(_, .rateLimited, _, _): state = .failed("Too many reset requests. Try again later.")
            case .server(_, .validationFailed, _, _): state = .failed("Enter a valid email address.")
            case .transport: state = .failed("Can't reach the server. Check your connection and retry.")
            default: state = .failed("The request failed. Try again shortly.")
            }
        }
    }
}
