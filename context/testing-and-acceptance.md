# Testing and Acceptance

## Deterministic Domain Tests
Use examples/refill-cases.json. Cover null threshold, inclusive threshold, zero, over-target, unknown, same product in multiple slots, invalid negative/fractional values, and score capping. Property checks: refill >= 0; refill <= target; known count >= target gives 0; unknown blocks confirmation; aggregation equals sum of per-slot refill. Test that client- or model-supplied totals are ignored/rejected.

## Database / API Integration
Apply migrations to an empty database and seed two organizations, two stores in organization A, admin A, manager A1, employee A1, employee A2, and admin B. Verify each matrix cell in auth-and-permissions.md. Use actual authenticated clients for RLS, not only service-role calls. Exercise tenant-mismatched FK attempts, direct published-slot edits, revoked membership, unauthorized storage download and arbitrary path upload. Test revision conflicts and repeated idempotency keys, including same key/different body.

## Jobs and Storage
Crash worker after claim and after provider return; lease expiry recovers. Deliver duplicate jobs; only one accepted result commits. Manual takeover during analysis fences late output. Model returns duplicate/missing/unknown slot IDs, fractional/negative count, invalid JSON, missing confidence, low confidence and poor alignment. Confirm unknowns are never zero-filled. Exercise timeout, 429, 5xx, configuration failure, exhausted retries, upload expiry, malformed JPEG, oversized dimensions, retention deletion, and provider outage/manual fallback.

## Client Acceptance
Real iPhone: camera permission allowed/denied, PhotosUI import/HEIC conversion, portrait/landscape EXIF normalization, crop, weak Wi-Fi, app background/resume and reauthentication. Validate Dynamic Type and VoiceOver. Web: login/logout, admin publish, manager assignment, employee denied management, rectangle drag plus numeric editing at desktop/tablet sizes. Verify all server validation messages and conflict recovery.

## Full Pilot Scenario
1. Admin invites users, creates store/display/products and publishes POG v1.
2. Manager assigns v1; employee performs and confirms a manual check.
3. Employee captures photo with a deliberately uncertain slot, resolves it, and confirms.
4. Admin publishes/assigns v2; historical scan still shows v1 targets, names and image.
5. Employee records completion; counts and original score stay unchanged.
6. Provider becomes unavailable; employee completes a new manual check.
7. Revoke employee membership; API and newly requested image links are denied.

## Accuracy and Usability Protocol
Begin with 30–50 real photos across fullness, lighting, people, angles and container arrangements for discovery. Keep an additional held-out set (at least 20 photos for pilot, expand before generalizing) captured in different sessions; do not tune prompts on it. Two people reconcile ground-truth visible and physically counted totals. Distinguish countable visible slots from hidden stock. Report denominator/sample size per display, not just pooled accuracy.

Release target: >=85% exact count on countable held-out slots; report overall unknown rate and error on supposedly high-confidence slots. Manual review must catch unsafe-to-use unknowns by construction. This metric alone is insufficient to validate hidden stock. If useful accuracy is not achieved, release manual workflow only and revise capture/POGs.

Track median employee completion time, p95 analysis latency (including queue), confirmation corrections, retry rate, manual-mode rate and estimated provider cost per scan. Timing targets in project-overview.md remain provisional until measured.

## Release Blockers
Any cross-store data leak, incorrect refill arithmetic, uncertain slot silently treated as empty, late AI overwrite of human edits, loss of published POG history, inability to use manual mode during provider failure, or missing rollback/recovery procedure blocks pilot release.
