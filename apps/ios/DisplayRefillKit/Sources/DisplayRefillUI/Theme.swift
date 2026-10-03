import SwiftUI

/// Semantic roles from context/ui-context.md, mapped to native system colors
/// so light/dark appearance and accessibility settings follow the system.
public enum Theme {
    public static var page: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    public static var surface: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    public static let action = Color.accentColor
    public static let destructive = Color.red
    /// Always paired with text or an icon; never the only status signal.
    public static let verify = Color.orange
    public static let confirmed = Color.green
}
