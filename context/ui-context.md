# UI Context

## Theme
Build a clear workplace tool usable under bright store lighting. iOS follows system light/dark appearance and uses native semantic colors. Web supports light and dark semantic tokens; light is the initial default. Do not inherit a dark technical canvas aesthetic.

| Role | iOS | Web token |
| --- | --- | --- |
| Page | system background | `--background` |
| Surface | secondary system background | `--card` |
| Main text | primary | `--foreground` |
| Supporting text | secondary | `--muted-foreground` |
| Action | accent color | `--primary` |
| Destructive | semantic red | `--destructive` |
| Verify | warning + text/icon | `--warning` |
| Confirmed | success + text/icon | `--success` |

Choose actual brand colors during design implementation and verify contrast. Web components consume CSS variables rather than hardcoded per-component colors. Use SF system typography and SF Symbols on iOS; system sans or Geist and Lucide on web. Counts and quantities need tabular numerals. Use restrained cards, visible separators, and generous spacing.

## iOS Navigation
Sign in → store/display list → capture/import or manual → photo review/crop → processing → count review → confirmed refill list → completion. History is a primary tab with drill-down. A manager using iOS retains employee workflows; management lives on web.

## Count Review
Rows show product, slot label, target, estimated/current count, and status. Provide stepper and direct numeric entry. Unknown starts blank, never zero. Required verification rows appear first; a checkbox or equivalent explicit action accepts an unchanged estimate. Confirm remains disabled with a clear unresolved count. High-confidence estimates are still labeled estimates until overall confirmation.

Refill view groups quantities by product but supports expansion to contributing slots. Show “Refill 2” rather than “Make 2” because production readiness is outside scope. Show scan timestamp and “Counts reflect this check.” Completion text: “Mark refill completed.” Do not imply the camera verified completion.

## Web Layout
Persistent navigation: Stores, Displays, Products, POGs, Scans, Members (admin). Store filter is always visible for managers. POG editor has reference photo, selectable rectangles, numeric rectangle inputs, and side panel for product, target, trigger, and slot label. Provide keyboard movement/resizing and numeric alternatives to dragging. Published versions are read-only with “Create new draft.” No collaborative editing or live presence.

## Accessibility and States
Support Dynamic Type, VoiceOver, web keyboard navigation, visible focus, and at least 44-point touch targets on iOS. Status never relies solely on color. Every feature needs loading, empty, permission-denied, validation, expired-session, and retry states. Preserve form input across retryable failures. Announce upload/analysis status without fabricated percentage progress.

## Error Copy
- Camera denied: “Allow camera access in Settings, choose a photo, or enter counts manually.”
- Alignment unclear: “We couldn’t match this photo to the layout. Retake or enter counts.”
- Analysis failed: “We couldn’t analyse this photo. Retry or enter counts manually.”
- Offline: “Connect to save counts and calculate a refill list.” Do not promise automatic sync.
- Version conflict: “This scan changed on another device. Reload before saving.”
- Expired image: “Photo removed under retention policy. Counts and review history remain.”
