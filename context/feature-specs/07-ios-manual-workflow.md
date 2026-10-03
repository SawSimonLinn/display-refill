# iOS Manual Workflow

## Status
Implemented; local backend/Swift client verification passes. iOS target, simulator/device, actual app relaunch and assistive-technology acceptance remain unverified (Xcode unavailable). Not acceptance-complete.

## Dependencies
Feature(s): 03, 04, 05, 06. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Build login → assigned store/display → manual count entry → provisional refill → confirm → completion → reopen detail. Initialize each count unknown; support numeric entry and stepper from an explicit entered value. Save through counts API with expected_revision and correction provenance. Show pinned target and optional trigger. Display product-grouped refill with expandable slot details. No image or vision provider is necessary. Manual fallback requires network; preserve unsaved form in memory during transient failure without claiming durable offline sync.

## Acceptance Criteria
- Employee can complete a whole manual check with vision disabled.
- Missing count blocks confirmation; explicit zero remains distinguishable from blank.
- Server-calculated quantities and revisions drive the UI.
- A stale edit gets actionable reload/conflict behavior.
- Completion records time/actor without changing observed counts.
- VoiceOver/Dynamic Type work; app can reopen persisted scan after restart.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
