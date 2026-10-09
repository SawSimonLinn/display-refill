import SwiftUI

/// Semantic roles from context/ui-context.md, mapped to native system colors
/// so light/dark appearance and accessibility settings follow the system.
/// The look is monochrome: soft grey page, white cards, ink for actions.
public enum Theme {
    public static var page: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemGroupedBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    public static var surface: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemGroupedBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    /// Filled input and chip background, one step off the card.
    public static var field: Color {
        #if canImport(UIKit)
        Color(uiColor: .tertiarySystemFill)
        #else
        Color.secondary.opacity(0.12)
        #endif
    }

    /// Text and icons placed on an ink fill.
    public static var onAction: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    public static var hairline: Color { Color.primary.opacity(0.08) }

    /// Ink: black in light mode, white in dark mode.
    public static let action = Color.primary
    public static let destructive = Color.red
    /// Always paired with text or an icon; never the only status signal.
    public static let verify = Color.orange
    public static let confirmed = Color.green

    public static let radius: CGFloat = 20
    public static let smallRadius: CGFloat = 14
}

// MARK: - Building blocks

extension View {
    /// White rounded card on the grey page.
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }

    /// Grey page background for scroll views, lists and forms.
    func pageBackground() -> some View {
        self.scrollContentBackground(.hidden).background(Theme.page.ignoresSafeArea())
    }

    /// Filled, borderless text field.
    func filledField() -> some View {
        self.textFieldStyle(.plain)
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.smallRadius, style: .continuous))
    }
}

/// Full-width ink capsule; the one primary action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .multilineTextAlignment(.center)
            .foregroundStyle(Theme.onAction)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .background(Theme.action.opacity(enabled ? 1 : 0.25), in: Capsule())
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Capsule())
    }
}

/// Compact ink capsule for inline row actions.
struct InkCapsuleStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.onAction)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .background(Theme.action.opacity(enabled ? 1 : 0.25), in: Capsule())
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Capsule())
    }
}

/// Outlined capsule for secondary actions.
struct OutlineButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.action)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .overlay(Capsule().strokeBorder(Theme.action.opacity(0.85), lineWidth: 1.2))
            .contentShape(Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.6 : 1) : 0.3)
    }
}

/// Small rounded chip, like a tag or a status.
struct Pill: View {
    let text: String
    var systemImage: String?
    var filled = false
    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).imageScale(.small) }
            Text(text)
        }
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .foregroundStyle(filled ? Theme.onAction : Theme.action)
        .background {
            if filled { Capsule().fill(Theme.action) } else { Capsule().strokeBorder(Theme.action.opacity(0.7), lineWidth: 1) }
        }
    }
}

/// Quiet uppercase label above a group of content.
struct Eyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).tracking(0.6)
    }
}

/// Inline message box; the icon carries the meaning alongside the tint.
struct Notice<Actions: View>: View {
    let text: String
    var systemImage = "exclamationmark.circle"
    var tint: Color = Theme.verify
    @ViewBuilder var actions: Actions
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label { Text(text).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: systemImage).foregroundStyle(tint) }
                .font(.subheadline)
            actions
        }
        .card()
    }
}

extension Notice where Actions == EmptyView {
    init(text: String, systemImage: String = "exclamationmark.circle", tint: Color = Theme.verify) {
        self.init(text: text, systemImage: systemImage, tint: tint) { EmptyView() }
    }
}

/// Password entry with a show/hide button. Keeps the keyboard up while toggling.
struct PasswordField: View {
    let title: String
    @Binding var text: String
    /// New-password autofill (sign-up) instead of saved-password autofill.
    var isNew = false
    @State private var visible = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 4) {
            Group {
                if visible {
                    plainField
                } else {
                    SecureField(title, text: $text)
                }
            }
            .textContentType(isNew ? .newPassword : .password)
            .focused($focused)
            Button {
                let wasFocused = focused
                visible.toggle()
                if wasFocused { Task { @MainActor in focused = true } }
            } label: {
                Image(systemName: visible ? "eye.slash" : "eye")
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(visible ? "Hide password" : "Show password")
        }
        .filledField()
    }

    @ViewBuilder private var plainField: some View {
        #if os(iOS)
        TextField(title, text: $text)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        TextField(title, text: $text).autocorrectionDisabled()
        #endif
    }
}
