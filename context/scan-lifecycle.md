# Scan Lifecycle and Durable Jobs

## States
| From | Event | To | Guard |
| --- | --- | --- | --- |
| none | Create photo scan | awaiting_upload | Active display and published POG |
| none | Create manual scan | needs_review | Slots initialized unknown |
| awaiting_upload | Validated upload + enqueue | queued | Exact upload intent and immutable object |
| queued | Worker claims lease | processing | Current generation and active job |
| processing | Validated detections committed | needs_review | Current lease token/generation; photo not superseded |
| processing | Permanent/exhausted failure | failed | Failure code persisted |
| processing | Retryable failure | queued | Attempt budget remains; backoff set |
| failed | Explicit retry | queued | Image retained; photo mode; retry limit enforced |
| awaiting_upload/queued/processing/failed | Manual takeover | needs_review | Authorized actor; generation incremented; old job cancelled |
| needs_review | Save counts/verification | needs_review | Matching revision |
| needs_review | Confirm | confirmed | All counts resolved; matching revision |
| confirmed | Attest completion | completed | Matching revision |

Manual takeover keeps already stored AI evidence but invalidates in-flight work and starts all accepted counts unknown. Source becomes manual; original image and attempts remain associated for audit. No transition back to AI after review begins; use a new scan. A retake also creates a new scan. Abandoned awaiting_upload records expire after 24 hours and become failed with `UPLOAD_EXPIRED`; manual takeover remains available.

## Queue Contract
A dedicated persistent TypeScript worker polls Postgres (initial interval 1 second with idle backoff). Claim due jobs atomically using row locking/skip-locked semantics. Assign a unique lease token, increment attempt_count, and set a 90-second lease. Provider deadline is 45 seconds; heartbeat every 20 seconds while work is active. Reclaim expired leases. All job updates and final writes are conditional on the current lease token and generation. Commit detections, scan state, and job success in one transaction. Worker state transitions increment scan revision, so manual actions from an older polling result may require a reload. Serializing claim by store (row lock or advisory lock) enforces the two-active-jobs-per-store limit across worker processes; skip a store at capacity while continuing other stores.

Initial automatic budget: three provider attempts per generation, with 5-second then 20-second backoff plus jitter; honor longer provider Retry-After within operational bounds. Retry 429, transient 5xx, network/timeouts. Do not retry authorization/configuration failures blindly. Schema-invalid output permits one retry inside the same total budget; then fail. Explicit retry allows at most two additional generations per scan, enforced server-side. Record every provider attempt; duplicated billing after worker death is possible, duplicated accepted results are not.

## Concurrency
All human mutations require expected_revision; successful mutation increments it. Conflict returns 409 with latest revision. Manual takeover increments job generation before cancelling jobs, so a late worker cannot overwrite human entry. Two devices confirming the same revision: one wins, one gets conflict. Completion is idempotent for a repeated key. Never merge contradictory corrections silently.

## Client Recovery
Create with idempotency key before uploading. If a request times out, retry the same body/key or retrieve scan state. Poll GET scan every 2 seconds initially, back off to 5 seconds, stop when not queued/processing. Backgrounding stops polling; foreground resumes by scan ID. At 30 seconds show delay and manual option, not invented progress. A client disconnect does not cancel the durable worker.

## Implemented (Feature 09)
Migration `…1400_vision_pipeline.sql` implements the table above for worker and human analysis transitions. `claim_scan_job` takes due queued jobs and expired leases (`for update skip locked`, scan row before job row), serializes per store with a transaction advisory lock and skips stores holding two live leases. A claim increments `attempt_count`, issues a new lease token for 90 seconds, moves `queued` → `processing` (revision +1) and inserts an `in_progress` attempt with provider/model/prompt/schema/policy versions and the confidence threshold. An expired lease marks its attempt `timeout`/`LEASE_EXPIRED`; on the third attempt it fails the scan with `ANALYSIS_TIMEOUT`. Jobs of an older generation or a scan no longer queued/processing are cancelled; a missing/deleted image fails with `IMAGE_UNAVAILABLE`.

`finish_scan_attempt` always records attempt evidence, then applies job/scan changes only for the current lease, current generation and `processing` scan (otherwise `fenced`; the attempt becomes `superseded`). Success writes slot observations, accepted copies, review flags, `ai_summary`, job success, `needs_review` and audit in one transaction. Failures requeue with backoff while budget remains (schema-invalid output once), otherwise set `failed` with the code in `scans.failure_code` and `scan_jobs.last_error_code`. Heartbeats extend only a current lease and return false when fenced; the worker then aborts its provider call.

`scan_analysis_action` implements explicit retry (new generation and job, `retry_generation_count` ≤ 2) and manual takeover (generation +1 before cancelling jobs and in-flight attempts; counts reset unknown/pending; source manual; image and evidence retained). The worker (`workers/scan-worker`) polls every second with idle backoff to 10 s, runs up to two jobs per process, heartbeats every 20 s and enforces the 45-second provider deadline even when an adapter ignores abort. iOS polling follows Client Recovery (decision D68). Not implemented here: the 24-hour `awaiting_upload` → `failed`/`UPLOAD_EXPIRED` sweep (Feature 12 scheduling), operator vision disable switch and cost telemetry (Feature 12).

## Implemented (Feature 10)
No state or queue change. iOS now calls manual takeover from the photo screen once analysis is past the 30-second delay notice or has failed, then opens the same scan's counts. A 409 (analysis committed first, or another device acted) reloads the scan instead of retrying. Review saves and confirmation keep the Feature 06 revision rules; the database additionally refuses clearing `review_required` once review starts (D69).
