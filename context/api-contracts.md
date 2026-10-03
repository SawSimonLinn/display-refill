# API Contracts

## Conventions
Base `/api/v1`. HTTPS JSON; snake_case fields and UUID IDs. Auth via Supabase bearer token (iOS) or validated SSR cookie (web). Never accept actor_id or role as authority. Cookie mutations enforce same-origin/CSRF. Data responses: `{ "data": ... , "request_id": "..." }`; errors: `{ "error": { "code": "...", "message": "...", "field_errors": {} }, "request_id": "..." }`.

400 malformed JSON; 401 invalid session; 403 disallowed action; 404 missing/inaccessible resource where disclosure matters; 409 revision/state/idempotency conflict; 422 invalid fields; 429 rate limited; 503 dependency unavailable. Return Retry-After for rate limits. Lists use opaque cursor over created_at/id, default 25, maximum 100; filters never expand authorization.

Mutating POSTs use `Idempotency-Key` scoped to actor+route, stored for 24 hours. Same key/body returns original resource/result; different body is 409. PATCH uses expected_revision plus idempotency for retry safety. Atomic RPCs own multi-table changes. Clients never PATCH refill totals or raw AI fields.

## Implemented Conventions (feature 01)
Error codes and their statuses live in `packages/domain/src/api.ts`: MALFORMED_JSON 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, METHOD_NOT_ALLOWED 405, CONFLICT 409, POG_CHANGED 409, VALIDATION_FAILED 422, POG_NOT_ASSIGNED 422, UNRESOLVED_COUNTS 422, RATE_LIMITED 429, INTERNAL_ERROR 500, NOT_IMPLEMENTED 501, DEPENDENCY_UNAVAILABLE 503, CONFIGURATION_INVALID 503. Clients must tolerate unknown codes. `field_errors` is always present (possibly `{}`). Every response carries `Cache-Control: no-store` and an `x-request-id` header; a well-formed UUID supplied in `x-request-id` is reused, otherwise the server issues one. Unknown `/api/v1` paths return the JSON 404 envelope.

`GET /api/v1/health` (unauthenticated): 200 `{ data: { status: "ok", service: "admin-api", api_version: "v1", checked_at, checks: { configuration: "ok", database: "not_checked", authentication: "not_implemented", job_queue: "not_implemented" } } }`, or 503 `CONFIGURATION_INVALID` without naming variables. Check values change as later features wire real dependencies.

## Database Functions Used by the API (feature 02)
`publish_pog_version(p_actor, p_version_id, p_expected_revision, p_request_id)` and `create_scan(p_actor, p_display_id, p_source, p_expected_pog_version_id)` are callable only with the service role. Their Postgres error message is the API error code (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_FAILED`, `POG_NOT_ASSIGNED`, `POG_CHANGED`); trigger rejections use `IMMUTABLE` (map to 409) and `LAST_ADMIN` (map to 409). `create_scan` returns `scan_id, status, revision, pog_version_id, slot_count, upload_bucket, upload_object_path, upload_expires_at`; the API adds the signed upload URL (feature 08).

## Read Routes
| Route | Result |
| --- | --- |
| GET /me | Profile, organization and active store memberships |
| GET /stores | Accessible active stores; managers/admin may include archived |
| GET /stores/:id/displays | Displays with current published POG summary and latest scan timestamp |
| GET /displays/:id | Display + pinned current layout/product metadata |
| GET /products | Authorized catalog projection |
| GET /pogs; GET /pogs/:id/versions/:version_id | Authorized templates and immutable/draft detail |
| GET /scans?store_id=&display_id=&status=&cursor= | Authorized history summaries |
| GET /scans/:id | State, revision, pinned layout, slot observations/review/finals, attempts summary, completion |
| POST /scans/:id/image-access | Short-lived image link after resource access check |

## Administrative Routes
- POST /stores; PATCH /stores/:id: admin name, store_number, timezone, active.
- POST /stores/:id/displays; PATCH /displays/:id: manager/admin name, active, active_pog_version_id. Assignment must be published and same organization.
- POST /products; PATCH /products/:id: admin product metadata/active.
- POST /pogs: admin name; creates draft version 1.
- POST /pogs/:id/versions: admin clones a published version or creates blank next draft.
- PATCH /pog-versions/:id: admin draft name/reference metadata and expected_revision.
- PUT /pog-versions/:id/slots: admin full replacement set plus expected_revision; validate each rectangle and product.
- POST /pog-versions/:id/publish: expected_revision; validate image, coordinates, slots, products, quantities; atomically freeze version.
- POST /pog-versions/:id/upload-intent and POST /pog-versions/:id/finalize-image: validated draft reference upload.
- GET /members; POST /members/invite; PATCH /members/:user_id: admin organization/store assignments and revocation. Never allow removal of the last active organization admin.
No hard-delete API for referenced catalog/history in MVP.

## Create Scan
`POST /scans` with `{ "display_id": "UUID", "source": "photo" }` or source manual. Manual creation accepts no image; photo creation initially uses the full image crop until finalize supplies crop_json. Server resolves store, pins current POG, copies slot snapshots and returns 201 with scan_id, status, revision and optional upload intent `{bucket, object_path, upload_url, expires_at}`. No caller-provided targets, slot coordinates or arbitrary URL. Missing published POG returns `POG_NOT_ASSIGNED` (422). Mobile can optionally send expected_pog_version_id; mismatch returns 409 `POG_CHANGED` for a refreshed preview.

`POST /scans/:id/finalize-upload` with `{ "expected_revision": 1, "captured_at": "RFC3339", "crop": {"x":0,"y":0,"width":1,"height":1} }`. Crop refers to upright uploaded photo, obeys normalized constraints; server generates canonical crop. captured_at is optional informational client time. On valid upload, transaction enqueues and returns 202. Invalid upload leaves awaiting_upload with a retriable validation error; replacing photo requires a new scan. Already finalized same request returns existing state without enqueueing twice.

## Review Operations
`PATCH /scans/:id/counts` body:
```json
{
  "expected_revision": 4,
  "items": [
    { "slot_id": "11111111-1111-4111-8111-111111111111", "quantity": 2, "verified": true, "reason": "count_corrected" }
  ]
}
```
Slot ID means pinned pog_slot_id in all public contracts. Nonempty items, no duplicates, only pinned slots, integer 0–999. Reasons: count_corrected/visibility_check/wrong_product/manual_count or null. Saves accepted counts, review state and append-only correction events atomically; returns revision and provisional server refill quantities. Omitted slots remain unchanged. `verified: true` is required to resolve a required-review slot, including accepting the original estimate.

`POST /scans/:id/manual-takeover` with expected_revision invalidates worker generation and initializes manual review. `POST /scans/:id/retry` only for failed retained photo scans with remaining budget. Both return current state/revision.

`POST /scans/:id/confirm` with expected_revision: backend validates all counts/review requirements, recomputes/refreezes final results and returns 200. `UNRESOLVED_COUNTS` is 422 with slot IDs. `POST /scans/:id/complete` with expected_revision: accepts only confirmed scan, records attestation, returns completed state. No editing after confirmation.

## Scan Detail Shape
Includes scan_id, display_id, pog_version_id, status, source, revision, created_at, image_available, slots, provisional_total_refill, total_refill, display_score, confirmed_at, completed_at. Slots include slot_id, product_id, product_name, target, refill_threshold, ai_quantity, confidence, flags, accepted_quantity, review_required, review_state, final_quantity, refill_quantity. Final totals remain null until confirmed; provisional total is null if any count unknown. Any known provisional recommendation is explicitly labeled unconfirmed.

## Rate Limits
Initial server-configurable limits: 10 new photo scans per user per minute, 2 concurrently processing per store, 100 slots per scan. Queue excess store concurrency rather than losing accepted work. Rate-limit invitations and password-sensitive operations separately. Limits are pilot defaults; tune from measurements.
