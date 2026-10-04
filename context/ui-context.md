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

## Implemented POG Editor (feature 05)
Admins open a draft from POGs, upload/orient/select reference bounds, draw/select/drag/resize rectangles, or create them with “Add slot” and numeric fields. Focused rectangles: arrows move, Shift+arrows resize, Alt/Option makes fine steps, Delete/Backspace removes, Escape deselects. Position percentages commit with Enter/blur; invalid/uncommitted coordinates block saving/publication. All slot metadata is editable in labeled fields, with inclusive-trigger wording and a selectable slot table.

Saving is explicit, with unsaved/saving/saved/failed/conflict text. A conflict keeps the local layout; “Reload latest” discards it, or “Save mine over it” explicitly confirms replacement after fetching the latest revision. This override refuses a changed reference until reload/review. Edits are blocked while saving; unsaved slot values can be restored in the same tab at the same revision. Publication requires a saved valid draft and confirmation; published layouts are read-only with clone/blank-draft actions. Reference replacement displays a required “I checked every slot” checkbox, applied on save. Display assignment is a separate action on Displays.

Keyboard/browser geometry checks do not establish screen-reader accessibility, contrast, dark-mode review or iOS/device support; unresolved checks are recorded in the progress tracker.

## Implemented Count Review (Feature 10, iOS)
Photo-scan review uses the Feature 07 count screen with additions: a "Photo estimates" summary (synthetic label, alignment/quality notes, "N of M slots need your check"), and per slot the AI estimate, saved count, plain-language reasons, and a text+icon status (Needs your check / Checked, save to record / Unsaved correction / Verified by a person / Estimate, not verified). Required slots are listed first. "I checked: N is correct" is a button with toggle semantics (exposed to assistive technology as a switch with Checked/Not checked value) because a SwiftUI Toggle label can clip at accessibility sizes. Confirmed scans show the estimate beside the confirmed count and a "Found a mistake?" section offering a new check. Native clipping/hit-region/description/Dynamic Type audits pass at default and largest sizes in the simulator; spoken VoiceOver is unverified.

## Implemented History and Review (Feature 11)
**iOS:** a History tab between Check and Saved checks. Store picker (when assigned to several stores), newest-first rows with display, store-local time and zone, pinned layout version, status (text + icon), "Confirmed refill: N" or "Not confirmed", "marked done", source, synthetic-analysis and photo-removed notes. "Load more checks" with a count line ("Showing 25 checks. More are available." / "All N checks shown."); load-more failure keeps rows and offers retry; pull to refresh; loading, empty, error, session-expired states. The record shows Check facts, then separate **Provisional recommendation** (with "Continue this check" when still editable) or **Confirmed refill quantity**, a **Completion attestation** section ("This is an attestation, not a new stock count."), per-slot original estimate / review reasons / accepted / confirmed counts, the correction trail and the photo (retained via a five-minute link, renewable when it expires; removed: "Photo removed under retention policy. Counts and review history remain."). Content-sized sections in a scroll view, as for the count screen. Simulator native audits pass at default and largest sizes; spoken VoiceOver unverified.
**Web:** `/scans` filter form (store, display of the chosen store, status, from/to dates in the store's zone or UTC) using native controls submitted with Apply (keyboard operable), table with caption and row-header links, "Show more"/"Back to newest". `/scans/:id` record with the same three separated result panels, slots and corrections tables, photo panel (client fetch; deleted/no-photo/session/failed + Try again states) and, for managers/admins, analysis attempt versions. No page-level horizontal scroll at 390 px (tables scroll inside their container).
