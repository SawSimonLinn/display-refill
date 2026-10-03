import DisplayRefillCore
import SwiftUI

/// Placeholder until Supabase Auth sign-in lands in feature 03. The fields are
/// disabled and nothing is submitted or stored.
public struct SignInPlaceholderView: View {
    @State private var health: HealthCheckModel
    private let onPreviewShell: () -> Void

    public init(client: any APIClient, onPreviewShell: @escaping () -> Void) {
        _health = State(initialValue: HealthCheckModel(client: client))
        self.onPreviewShell = onPreviewShell
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Sign-in is not available yet. It arrives with Supabase Auth in a later update.", systemImage: "info.circle")
                        .foregroundStyle(.secondary)
                }
                Section("Account") {
                    TextField("Email", text: .constant(""))
                    SecureField("Password", text: .constant(""))
                    Button("Sign in") {}
                }
                .disabled(true)

                Section("Server") {
                    ServerStatusRow(state: health.state)
                    Button("Check again") { Task { await health.check() } }
                        .disabled(health.state == .loading)
                }

                Section {
                    Button("Preview navigation (no data)", action: onPreviewShell)
                }
            }
            .navigationTitle("Display Refill")
            .task { await health.check() }
        }
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
