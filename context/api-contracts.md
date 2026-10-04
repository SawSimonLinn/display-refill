# API Contracts

## Conventions
Base `/api/v1`. HTTPS JSON; snake_case fields and UUID IDs. Auth via Supabase bearer token (iOS) or validated SSR cookie (web). Never accept actor_id or role as authority. Cookie mutations enforce same-origin/CSRF. Data responses: `{ "data": ... , "request_id": "..." }`; errors: `{ "error": { "code": "...", "message": "...", "field_errors": {} }, "request_id": "..." }`.

400 malformed JSON; 401 invalid session; 403 disallowed action; 404 missing/inaccessible resource where disclosure matters; 409 revision/state/idempotency conflict; 422 invalid fields; 429 rate limited; 503 dependency unavailable. Return Retry-After for rate limits. Lists use opaque cursor over created_at/id, default 25, maximum 100; filters never expand authorization.

Mutating POSTs use `Idempotency-Key` scoped to actor+route, stored for 24 hours. Same key/body returns original resource/result; different body is 409. PATCH uses expected_revision plus idempotency for retry safety. Atomic RPCs own multi-table changes. Clients never PATCH refill totals or raw AI fields.

## Implemented Conventions (feature 01)
Error codes and their statuses live in `packages/domain/src/api.ts`: MALFORMED_JSON 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, METHOD_NOT_ALLOWED 405, CONFLICT 409, POG_CHANGED 409, VALIDATION_FAILED 422, POG_NOT_ASSIGNED 422, UNRESOLVED_COUNTS 422, RATE_LIMITED 429, INTERNAL_ERROR 500, NOT_IMPLEMENTED 501, DEPENDENCY_UNAVAILABLE 503, CONFIGURATION_INVALID 503. Clients must tolerate unknown codes. `field_errors` is always present (possibly `{}`). Every response carries `Cache-Control: no-store` and an `x-request-id` header; a well-formed UUID supplied in `x-request-id` is reused, otherwise the server issues one. Unknown `/api/v1` paths return the JSON 404 envelope.

`GET /api/v1/health` (unauthenticated): 200 `{ data: { status: "ok", service: "admin-api", api_version: "v1", checked_at, checks: { configuration: "ok", database: "not_checked", authentication: "not_checked", job_queue: "not_checked" } } }` (job_queue was `not_implemented` before Feature 09), or 503 `CONFIGURATION_INVALID` without naming variables. Check values change as later features wire real dependencies.

## Database Functions Used by the API (feature 02)
`publish_pog_version(p_actor, p_version_id, p_expected_revision, p_request_id)` and `create_scan(p_actor, p_display_id, p_source, p_expected_pog_version_id)` are callable only with the service role (feature 03 adds `list_organization_members`, `apply_membership_invite`, `update_membership` and `bootstrap_first_admin` on the same terms). Their Postgres error message is the API error code (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_FAILED`, `POG_NOT_ASSIGNED`, `POG_CHANGED`); trigger rejections use `IMMUTABLE` (map to 409) and `LAST_ADMIN` (map to 409). `create_scan` returns `scan_id, status, revision, pog_version_id, slot_count, upload_bucket, upload_object_path, upload_expires_at`; the API adds the signed upload URL (feature 08).

## Implemented Routes (feature 03)
| Route | Auth | Result |
| --- | --- | --- |
| `GET /api/v1/me` | bearer or cookie | `{ user_id, email, display_name, organizations[{organization_id,name,role}], stores[{store_id,organization_id,name,store_number,timezone,role: employee|manager|admin}], capabilities{dashboard, admin_organization_ids} }`. Active stores only |
| `GET /api/v1/members[?organization_id=]` | org admin | `{ organization_id, members[{user_id,email,display_name,org_role,active,revision,invited_at,last_sign_in_at,stores[{store_id,role,active}]}] }` |
| `POST /api/v1/members/invite` | org admin, `Idempotency-Key` | Body `{ organization_id?, email, display_name?, org_role: member|admin, stores[{store_id, role: employee|manager}] }` (strict). 201 `{ user_id, revision }`. 409 when the email already has an account; 422 for unknown/other-org/archived stores (nothing created) |
| `PATCH /api/v1/members/:user_id` | org admin, `Idempotency-Key` | Body `{ organization_id?, expected_revision, org_role?, active?, stores? }`; `stores` replaces the full active set. 200 `{ user_id, revision }`; 409 stale revision or last active admin |
| `POST /api/v1/auth/password-reset` | none | Body `{ email }` (strict; no redirect field). Always 202 `{ status: "sent_if_registered" }`; 429 with `Retry-After` when limited |

Common: 401 `UNAUTHENTICATED` (with `WWW-Authenticate: Bearer`) for a missing, malformed, expired, forged or signed-out token; 403 `FORBIDDEN` when the caller has no active membership, is not an admin, or sends a cookie-authenticated mutation without a same-origin `Origin`; 404 for another organization's resources; 503 `DEPENDENCY_UNAVAILABLE` when Supabase Auth or the database is unreachable. `organization_id` may be omitted when the caller administers exactly one organization. Idempotent replays return the stored response with `idempotent-replayed: true`; the same key with a different body is 409. Web form endpoints (`/auth/sign-in`, `/auth/sign-out`, `/auth/forgot-password`, `/auth/verify`, `/auth/set-password`) are HTML POSTs answering 303, not part of `/api/v1`.

## Implemented Routes (feature 04)
All require a verified session (bearer or cookie) and an active membership. Mutations require `Idempotency-Key` (24 h replay; same key + different body = 409) and, for cookies, the same-origin check. Request bodies are strict: unknown fields (including `organization_id`, `store_id` or `active` where a route does not accept them) are 422. Organization and store ownership of an existing record always comes from the stored row.

| Route | Who | Result |
| --- | --- | --- |
| `GET /api/v1/stores` | any member | Page of `Store { store_id, organization_id, name, store_number, timezone, active, revision, created_at, updated_at }` the caller can access (RLS) |
| `POST /api/v1/stores` | org admin | Body `{ organization_id?, name, store_number, timezone }` → 201 `Store`. Duplicate store number (case-insensitive, per organization) → 422 `field_errors.store_number`; unknown IANA zone → 422 `field_errors.timezone` |
| `PATCH /api/v1/stores/:store_id` | org admin of the store's organization | `{ expected_revision, name?, store_number?, timezone?, active? }` → 200 `Store`; `active: false` archives (new scans blocked) |
| `GET /api/v1/products` | any member | `{ organization_id, items: Product[], next_cursor }`. Admins/managers: organization catalog; employees: products of their stores' layouts (RLS). `Product { product_id, organization_id, name, short_name, category, container_type, sku, plu, upc, active, revision, created_at, updated_at }` |
| `POST /api/v1/products` / `PATCH /api/v1/products/:product_id` | org admin | Create `{ organization_id?, name, short_name, category, container_type, sku?, plu?, upc? }` (codes nullable; UPC 6–14 digits). Patch any of those, `null` clears a code, `active` archives/restores. Renames never change scan snapshots |
| `GET /api/v1/pogs` | any member | `{ organization_id, items: Pog[], next_cursor }`; `Pog { pog_id, organization_id, name, archived, revision, created_at, updated_at, versions[{ pog_version_id, version_number, state, published_at, slot_count }] }` (newest first). Admins see drafts; managers published versions; employees versions used by their stores |
| `POST /api/v1/pogs` | org admin | `{ organization_id?, name }` → 201 `Pog` with an empty draft version 1 |
| `PATCH /api/v1/pogs/:pog_id` | org admin | `{ expected_revision, name?, archived? }`. Archived POGs cannot be newly assigned or published; assigned displays keep their version |
| `GET /api/v1/stores/:store_id/displays` | store access | Page of `Display { display_id, organization_id, store_id, name, active, revision, created_at, updated_at, active_pog{ pog_id, pog_name, pog_archived, pog_version_id, version_number, published_at } \| null, latest_scan_at, has_archived_products }` |
| `POST /api/v1/stores/:store_id/displays` | manager of that store, org admin | `{ name, active_pog_version_id? }` → 201 `Display`. Archived store → 422 `field_errors.store_id` |
| `GET /api/v1/displays/:display_id` | store access | `{ display, store{ store_id, name, store_number, timezone, active }, slots[{ slot_id, label, product_id, product_name, product_short_name, product_active, target_quantity, refill_threshold, sort_order }] }` |
| `PATCH /api/v1/displays/:display_id` | manager of the display's store, org admin | `{ expected_revision, name?, active?, active_pog_version_id? }` (`null` unassigns). A version that is not a published version of a non-archived POG in the display's organization (other organization, draft, unknown, archived POG) → 422 `field_errors.active_pog_version_id`, same message for all. Restoring a display in an archived store → 422 `field_errors.active` |

Lists: `?status=active|archived|all` (default active), `?limit=1..100` (default 25), `?cursor=` (opaque, issued in `next_cursor`; ordered oldest first by `created_at, id`), `?organization_id=` (products/POGs: required only for members of several organizations). `archived`/`all` are refused (403) for callers who do not manage that store/organization; for stores they include archived stores only of organizations the caller administers or stores the caller manages. A forged or malformed cursor is 422 `field_errors.cursor`.

Errors: 403 when the caller administers no organization (admin routes) or manages no store (display routes), or can see the store but is not its manager; 404 for records in stores the caller cannot access and in other organizations; 409 `CONFLICT` for a stale `expected_revision`; 422 with field errors as above. Database functions: `create_store`, `update_store`, `create_product`, `update_product`, `create_pog`, `update_pog`, `create_display`, `update_display` (service role only; decision D39).

## Implemented POG Builder Routes (feature 05)
All JSON bodies are strict. Resource ownership comes from the stored version, never a supplied organization. Authoring requires an active organization admin; manager display assignment remains Feature 04. Mutations use verified bearer or same-origin cookie sessions. JSON mutations below require `Idempotency-Key`, except upload-intent and image-access (short-lived actions, no stored URLs).

| Route | Body / result |
| --- | --- |
| `GET /pogs/:pog_id/versions/:version_id` | RLS-scoped `PogVersionDetail`: identity, version number/state/revision, source version, canonical `reference {width,height,validated_at}` or null, `slots_need_review`, slots with product names/active flag, visible open draft ID, and publication blockers. Drafts admin-only; published visibility follows D25 |
| `POST /pogs/:pog_id/versions` | `{source_version_id?: UUID|null}` → 201 next draft, blank or cloned from this POG's published version. One open draft per POG, serialized numbering; 409 if another draft exists |
| `PUT /pog-versions/:id/slots` | `{expected_revision, slots:[{slot_id?,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order}], confirm_coordinates?:boolean}` → 200 detail. Replaces the complete draft slot set transactionally; preserves IDs already in this draft. At most 100; case-insensitive unique labels (1–40 chars), coordinates at most six decimals, target 1–999, trigger null or inclusive 0–target, order 0–999. Overlaps/inactive products may remain in drafts but prevent publication. Invalid geometry, quantities or cross-org products → 422 |
| `POST /pog-versions/:id/upload-intent` | Empty body → 201 `{upload_id,bucket,object_path,upload_url,upload_method:"PUT",content_type:"image/jpeg",max_bytes,expires_at}`. Authenticated exact-path API upload URL, **not a Supabase signed upload token**. Ten-minute intent, actor-bound, max five pending per draft |
| `PUT /pog-versions/:id/uploads/:upload_id` | Raw JPEG bytes, authenticated as the intent's actor. Streams at most 10 MiB to private staging Storage without overwrite. Expired/settled intent or different retry bytes → 409; exact-byte retry → 200 `{uploaded:true}`. No idempotency record needed: path is write-once. MIME declarations are not validation; finalize decodes content |
| `POST /pog-versions/:id/finalize-image` | `{upload_id,expected_revision,rotation?:0|90|180|270,crop?:{x,y,width,height}}` → 200 detail. Crop is normalized to the upright image **after** EXIF orientation and the chosen rotation (default full image). Server checks actual JPEG, dimensions/area/size, applies orientation/crop, strips metadata and downsizes. Invalid bytes deleted and intent rejected; expired staging objects deleted. A revision conflict retains staging for another request with a new key. Replacement sets `slots_need_review` when slots exist; only a revision-checked slot save with `confirm_coordinates:true` clears it |
| `POST /pog-versions/:id/publish` | `{expected_revision}` → 200 immutable published detail. API checks the validated Storage object exists; DB locks/version-checks, validates reference/review/slots/products, publishes and audits atomically. Does **not** assign displays. 422 blockers, 409 stale/already published |
| `POST /pog-versions/:id/image-access` | Empty body → 200 `{url,expires_at,width,height}`; five-minute signed read after current RLS visibility check. Not persisted in idempotency or logs. Inaccessible/missing reference → 404 |

Upload output paths are `{org}/{pog}/{version}/reference-{upload_id}-{sha256}.jpg`, write-once and content-addressed. Concurrent different crops cannot overwrite a winning/published image. Clones share the immutable source reference but have new slot IDs; publication/assignment never rewrites historical scans or snapshots. Normalized geometry handles display scaling, **not camera perspective**. Reference uploads are Feature 05 only; scan-photo upload/capture remains Feature 08.

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
- POST /stores/:id/displays; PATCH /displays/:id: manager/admin name, active, active_pog_version_id. Assignment must be published and same organization. (Implemented in feature 04, see above; store, product and POG identity routes as well.)
- POST /products; PATCH /products/:id: admin product metadata/active.
- POST /pogs: admin name; creates draft version 1.
- POST /pogs/:id/versions: admin clones a published version or creates blank next draft.
- Draft reference metadata is set only by validated image finalization; POG names change through PATCH /pogs/:id. There is no arbitrary reference-metadata PATCH.
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

## Implemented Refill Routes (Feature 06)
`GET /scans/:id`, `PATCH /scans/:id/counts`, and `POST /scans/:id/confirm` are implemented. Reads use caller-scoped RLS and one relational database statement. Counts/confirmation require a verified session, cookie same-origin protection, `Idempotency-Key`, strict bodies as above, and the expected revision. Employees mutate only their own scans; assigned-store managers and organization admins may mutate other scans within their scope. Inaccessible stores/organizations return 404; another employee's visible scan returns 403 on mutation.

Detail adds `provisional: boolean`, `unresolved_slot_ids: UUID[]`, and `products: [{product_id,refill_quantity: integer|null}]`. Review slot `refill_quantity` and product quantities are provisional server calculations; `final_quantity` and `total_refill` stay null until confirmation. Unknown in any slot makes its product aggregate, provisional display total and score null; known products still have provisional aggregates. A known but unverified required-review slot can have a provisional recommendation/score but blocks confirmation. `UNRESOLVED_COUNTS` includes pinned slot IDs in `error.field_errors.slot_ids`. Dates are serialized as UTC RFC3339 with Z.

The service-role-only `mutate_scan_counts(p_actor,p_scan_id,p_expected_revision,p_action,p_items,p_key,p_request_id)` owns count corrections or confirmation, revision changes and the 24-hour idempotency record in **one transaction**. It rechecks authorization before replay; identical concurrent keys wait and return the original committed snapshot with `idempotent-replayed: true`. Different bodies with the same key or different keys racing on one revision get 409. Failed transactions leave no claim/result, so a retry cannot encounter an orphaned in-flight claim. Confirmation accepts no items or computed quantities and recomputes from locked pinned snapshots. Confirmation, slot finals, scan totals and audit commit together. Ordinary catalog routes retain their existing idempotency implementation.

Feature 07 owns scan creation HTTP orchestration, completion and the iOS manual UI; Feature 08 owns photo upload; Features 09/10 own AI evidence ingestion, confidence routing, takeover and the AI correction UI. Synthetic scans for Feature 06 verification use the existing `create_scan` RPC. No Feature 07/10 UI or completion/takeover routes are claimed here.

## Implemented Manual Workflow Routes (Feature 07)
- `POST /scans`: strict `{display_id, source:"manual", expected_pog_version_id?:UUID}` → 201 full scan detail (same presenter as Feature 06). Photo creation is implemented by the Feature 08 contract below. Missing POG → 422 `POG_NOT_ASSIGNED`; stale preview → 409 `POG_CHANGED`.
- `POST /scans/:id/complete`: strict `{expected_revision}` → 200 full completed detail, including `completed_at` and `completed_by`. Confirmed scans only; own scans for employees, store managers/org admins as in Feature 06. No counts, totals, score, confirmation, POG or stock mutations.
- Both require verified Auth, current database membership, cookie same-origin protection and `Idempotency-Key`. Service-role-only `manual_scan_workflow` wraps existing `create_scan` or completion and stores its response snapshot in the same transaction. Create replay is actor + POST /scans + key (including the display in the request hash); completion replay is actor + scan completion route + key. Authorization is checked before replay. Same body replays the original result, different body or stale revision returns 409. No new history-list endpoint.
- Saved-check navigation stores only scan IDs scoped to the account on the device. Each reopening fetches authorized persisted detail; unsaved counts exist only in memory and are not durable offline synchronization.

## Implemented Photo Routes (Feature 08; supersedes proposed photo shapes above)
- `POST /scans`: strict `{display_id,source:"photo",expected_pog_version_id}` → 201 `{scan:ScanDetail,upload:{upload_id,upload_url,expires_at,max_bytes},analysis_available:false}`. Expected POG is required. Creation and response replay commit atomically; same actor/key across manual/photo modes conflicts. Ten new photo scans per actor/minute are serialized/enforced in SQL; replay does not consume another scan. 429 includes Retry-After 60.
- `PUT /scans/:id/image`: verified bearer or same-origin cookie; exact server-generated staging path only. Streams up to 10 MiB, decodes actual JPEG bytes regardless of declared MIME; rejects unsupported/malformed/over-dimension content. Same-byte retry is 200 `{uploaded:true}`; different bytes cannot overwrite (409). Only the creating actor may upload/renew/finalize, including when another manager/admin can read the store's scan.
- `POST /scans/:id/renew-upload`: strict `{}` → 200 photo response with renewed ten-minute intent. Only pending `awaiting_upload` scans under 24 hours old; no image replacement or POG repinning.
- `POST /scans/:id/finalize-upload`: strict `{expected_revision,crop:{x,y,width,height}}`, Idempotency-Key → 200 photo response with queued scan. Coordinates are normalized to EXIF-upright uploaded pixels, six decimals maximum, never the preview container. Minimum 64 px per crop edge. Server revalidates raw bytes, crops/scales/strips metadata, writes an immutable content-addressed JPEG, then atomically sets image metadata, validates intent, enqueues one generation and commits replay. `captured_at` is server finalization time; client timestamps, dimensions, paths and URLs are not accepted. Lost-response replay works after staging cleanup/intent expiry. A different key on the old revision conflicts. Invalid raw bytes are rejected/removed; a tiny crop keeps staging for correction. Unreferenced competing canonical outputs await Feature 12 cleanup.
- `GET /scans/:id/image`: caller RLS read authorization → `{url,expires_at}` for a five-minute private validated-image link. No anonymous access; already-issued links can survive membership revocation until expiry.

Feature 08 itself has no worker/provider, analysis result or takeover endpoint; Feature 09 (below) adds them. Photo slots stay unknown and refill totals null until validated detections commit.

## Implemented Analysis Routes (Feature 09)
- `GET /scans/:id` adds `analysis: { generation, failure_code: string|null, retry_available, retries_remaining, alignment: "good"|"uncertain"|"poor"|null, image_flags[], provider: string|null, synthetic: boolean, manual_takeover_at: RFC3339|null }`. Slot `ai_quantity`/`confidence`/`flags`/`review_required` carry the committed observation; null quantity is unknown. Attempts, usage, model and lease data are not exposed to clients. `synthetic: true` marks deterministic mock output (provider `mock`), not a reading of the photo. Photo creation responses now return `analysis_available: true`.
- `POST /scans/:id/retry`: strict `{expected_revision}`, `Idempotency-Key` → 200 full scan detail, `status: queued`, next generation. Only `failed` photo scans with a retained image; at most two explicit retries per scan (409 `CONFLICT`, message names the exhausted retries); stale revision 409.
- `POST /scans/:id/manual-takeover`: strict `{expected_revision}`, `Idempotency-Key` → 200 full detail with `status: needs_review`, `source: manual`, all accepted counts unknown and pending, `image_available` unchanged. Allowed from awaiting_upload/queued/processing/failed; 409 once review has started. The generation increments before jobs are cancelled, so a late worker result is fenced. A pending upload intent is expired.
- Both: verified bearer or same-origin cookie session; creator, store manager or organization admin (other employees 403, other stores/organizations 404); the trusted function commits the change, audit and the 24-hour replay record together; same key + same body replays with `idempotent-replayed: true`, a different body is 409.
- Worker-only functions (service role): `claim_scan_job(provider, model, prompt_version, schema_version, policy_version, confidence_threshold)`, `heartbeat_scan_job(job, lease)`, `finish_scan_attempt(job, lease, outcome, error_code, retryable, retry_after_seconds, result, latency_ms, usage, input)`; `scan_analysis_action(actor, action, scan, expected_revision, key, request_id)` serves the two routes. Finish returns `committed`, `requeued` (with `retry_in_seconds`), `failed` (with `failure_code`) or `fenced`.

## Implemented Review and Corrections (Feature 10)
No new route and no response-shape change. Feature 10 uses `GET /scans/:id`, `PATCH /scans/:id/counts`, `POST /scans/:id/confirm` and `POST /scans/:id/manual-takeover` as above.
- Review routing is the server's `review_required`; clients only explain it from slot `flags`, `ai_quantity`, `confidence` and `analysis.alignment/image_flags`. `unresolved_slot_ids` (unknown accepted count, or required review not verified) is the authority for ordering and for blocking confirmation.
- Explicit acceptance of an unchanged estimate is an item with the same `quantity` and `verified: true`; it appends a correction with `previous_quantity = corrected_quantity` and `verified = true` and resolves the slot (D69). A `verified: false` save also appends a row, records `verified = false` and leaves the slot pending.
- The iOS client sends only changed counts and explicit checks for photo scans, with reasons: `wrong_product` when the slot carries that flag, `manual_count` where the AI had no estimate, `count_corrected` for a changed estimate, `visibility_check` for an accepted one (D70). Manual and taken-over scans keep the Feature 07 all-slot `manual_count` save.
- Saves on a stale revision or a confirmed/completed scan are 409 and append nothing; two devices saving the same revision get exactly one 200. Clients cannot send AI fields or totals (422). A confirmed mistake is corrected by creating a new scan; the confirmed one is unchanged.

## Implemented History and Review Routes (Feature 11)
All are GET, verified bearer or cookie session, `Cache-Control: no-store`. Each begins with the **same caller-scoped (RLS) read of `scans`**, so list, detail, record and image access share one boundary: employees and managers see assigned stores, org admins their organization. Inaccessible stores/displays/scans/organizations are 404 (indistinguishable from nonexistent); callers without an active membership get 403 (D36); no session is 401.
- `GET /scans?store_id=&display_id=&status=&from=&to=&organization_id=&cursor=&limit=` → `{items: ScanHistoryItem[], next_cursor}`. Strict query (unknown parameter, bad status, malformed cursor, `from >= to`, limit outside 1–100 → 422). Newest first over `(created_at desc, id desc)`; the opaque cursor carries Postgres's exact microsecond timestamp and id, so equal timestamps are neither repeated nor skipped and rows created while paging never shift later pages. `from` inclusive, `to` exclusive, RFC3339 with offset. A `store_id`/`display_id`/`organization_id` the caller cannot read is 404 rather than an empty page. `ScanHistoryItem { scan_id, organization_id, store{store_id,name,store_number,timezone}, display{display_id,name}, pog{pog_version_id,version_number,pog_name,published_at}, status, source, created_at, captured_at, confirmed_at, completed_at, total_refill (confirmed/completed only), display_score (confirmed only), image_state: none|retained|deleted, synthetic_analysis, manual_takeover, failure_code, created_by_you }`. No image paths or URLs.
- `GET /scans/:id/history` → review record `{ scan: ScanDetail (identical to GET /scans/:id), store, display, pog, created_at, captured_at, created_by: Actor, manual_takeover: {at, by}|null, image: {state, deleted_at}, corrections[{correction_id, slot_id, slot_label, product_name, previous_quantity, corrected_quantity, original_ai_quantity, reason, verified, scan_revision, created_at, actor}], confirmation: {confirmed_at, confirmed_by, scan_revision, total_refill, display_score}|null, completion: {attested_at, attested_by}|null, analysis_attempts: [...]|null, viewer: {staff_names_visible, analysis_metadata_visible} }`. `Actor {user_id, is_you, display_name}`; `display_name` and `analysis_attempts` (generation, attempt_number, provider, model, prompt/schema/policy versions, confidence_threshold, outcome, error_code, started/ended_at — never usage, lease tokens, input hashes or normalized responses) are filled only for the scan store's managers and org admins (D75). Corrections are ordered by time, then slot label, then id.
- `GET /scans/:id/image` (Feature 08 route, now shared code): `{url, expires_at}` five-minute link for a retained photo; **410 `IMAGE_DELETED`** "Photo removed under retention policy. Counts and review history remain." when `image_deleted_at` is set (only after the caller's read succeeded; others still get 404); 404 "This scan has no photo." for manual scans; 404 if the object is missing.
- No route mutates history; `PATCH|PUT|DELETE /scans/:id` and `POST /scans/:id/history` are 405. Mutations remain the Feature 06–10 routes with their existing authorization (another employee's scan: 403).
- New error code `IMAGE_DELETED` (410) in `packages/domain/src/api.ts`; iOS decodes it as `.imageDeleted`.
- The web dashboard pages `/scans` and `/scans/:id` call the same server functions (`listScanHistory`, `getScanRecord`) with the signed-in caller's client.
