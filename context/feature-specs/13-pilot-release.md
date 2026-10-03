# Pilot Evaluation and Release

## Status
Not started.

## Dependencies
Feature(s): 12. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Configure one actual store/display with owner-verified products, targets and triggers. Collect discovery photos and independent held-out photos under actual lighting/stock conditions. Reconcile ground truth including visible vs hidden units. Run testing-and-acceptance.md; report accuracy, unknown rate, high-confidence mistakes, workflow time, p95 analysis latency and cost. Distribute a controlled TestFlight build with support instructions. Expand to five/six layouts only after checking performance per display.

## Acceptance Criteria
- All security, correctness and uncertainty release blockers are cleared with evidence.
- Pilot report gives sample sizes and measured metrics, not assumed accuracy.
- Employees complete photo and manual workflows without developer intervention.
- Actual POG/threshold quantities are approved by store operator.
- Provider/retention/device/hosting open decisions are resolved for release.
- If vision misses target, manual-only pilot is explicitly labeled; photo workflow is not claimed validated.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
