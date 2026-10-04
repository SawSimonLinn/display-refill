# Scan History and Manager Review

## Status
Implemented locally (2026-10-03); evidence and open checks (spoken VoiceOver, physical device) in progress-tracker.md.

## Dependencies
Feature(s): 10. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Build paginated iOS history for assigned stores and web history with store/display/date/status filters. Show timestamp, source, pinned POG, confirmed recommended quantity and completion state distinctly. Detail shows original image when retained, observations, accepted/final counts, confidence flags, correction audit and model/prompt metadata where appropriate. Managers review assigned stores, not employee performance rankings. API access rules match list and detail/image endpoints.

## Acceptance Criteria
- Pagination has stable ordering with no accidental duplicate/missing rows under equal timestamps.
- Filters do not leak other stores or organizations.
- Historical name/target/version remain unchanged after configuration edits.
- Deleted photos show an explicit retained-metadata state.
- Completion is not mislabeled as detected stock or measured refill count.
- Employee cannot alter another employee’s scan via detail route.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
