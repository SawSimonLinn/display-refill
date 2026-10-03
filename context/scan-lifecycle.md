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
