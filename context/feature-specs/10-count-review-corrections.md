# Confidence Review and Correction Capture

## Status
Not started.

## Dependencies
Feature(s): 07, 09. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Extend the manual review UI to show original AI count beside accepted count and verification status. Sort required-review slots first. Explicitly accept unchanged uncertain estimates or enter corrected numbers. Retain original observations and append correction events with actor, previous value, new value, reason and revision. Confirm only when every unknown/required review is resolved. Explain wrong-product/occlusion flags without asserting identity. Add manual takeover from stalled/failed analysis. No automatic training or export is performed.

## Acceptance Criteria
- Low confidence, null confidence, quality flags and unknown values require explicit review.
- Accepting an unchanged estimate records verification; it is not lost because delta is zero.
- Human correction never overwrites original AI evidence.
- Editing any count recalculates through backend and increments revision atomically.
- Two-device edits conflict safely; confirmed scans reject further correction.
- A new scan is offered to correct a confirmed mistake.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
