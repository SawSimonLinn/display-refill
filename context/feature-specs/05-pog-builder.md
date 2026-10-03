# POG Builder and Publication

## Status
Complete and verified locally (2026-10-03). Migration 10; 120/120 database regression tests, 70/70 API tests including 11 real publication-workflow tests, 95/95 unit tests, visible Chromium editing/assignment and viewport/zoom checks. See [progress tracker](../progress-tracker.md#feature-05--verification-evidence) for evidence and unresolved iOS/accessibility environments.

## Dependencies
Feature(s): 04. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Admin uploads an upright reference, chooses canonical display bounds and draws nonoverlapping rectangles. Each slot has unique label, expected product, positive target, optional inclusive trigger and order. Store coordinates normalized to the canonical reference crop, independent of browser zoom/letterboxing. Provide numeric coordinate inputs and keyboard editing. Drafts autosave explicitly with revision conflict protection; published versions are read-only. Clone to a new version for changes. Replacing a draft image requires revalidating all slot locations. Publication and display assignment are separate actions.

## Acceptance Criteria
- The same slot renders correctly at multiple viewport sizes with no letterbox coordinate drift.
- Keyboard/numeric users can create and edit every rectangle property.
- Publish rejects missing reference, no slots, overlapping/out-of-bounds slots, inactive products and invalid triggers.
- Publishing freezes image and slots in a transaction and increments the version number uniquely.
- Editing a new draft cannot affect the currently assigned version.
- Scans created before reassignment retain the original version and slot snapshot.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
