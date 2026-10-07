import SwiftUI

#if os(iOS)
/// Keyboard accessory for fast number entry: Skip on the left, Next on the right.
/// Next turns into Done on the last field.
struct NumberEntryBar: ToolbarContent {
    let isLast: Bool
    let skip: () -> Void
    let next: () -> Void
    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .keyboard) {
            Button("Skip", action: skip)
                .accessibilityHint("Leaves this item blank and moves to the next one")
            Spacer()
            Button(isLast ? "Done" : "Next", action: next).bold()
        }
    }
}
#endif

/// The field after `current` in `fields`, or nil at the end.
func fieldAfter<ID: Equatable>(after current: ID?, in fields: [ID]) -> ID? {
    guard let current, let index = fields.firstIndex(of: current), index + 1 < fields.count else { return nil }
    return fields[index + 1]
}
