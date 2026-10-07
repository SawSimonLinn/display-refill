# Data Model

## Conventions
All IDs are UUID primary keys, timestamps UTC, counts integers. Tables below have created_at; mutable entities also have updated_at and integer revision. Organization/store foreign-key pairs use composite uniqueness/FKs where needed so a child cannot point outside its tenant. Auth identities live in auth.users; profiles are application data, not another identity provider.

## Tables
| Table | Required fields beyond conventions | Relationships / constraints |
| --- | --- | --- |
| organizations | name, active | Initial pilot has one organization |
| profiles | user_id, display_name | user_id PK references auth.users; no client-writable role |
| organization_memberships | organization_id, user_id, role, active | role `member` or `admin`; unique org/user |
| stores | organization_id, name, store_number, timezone, active | Unique org/store_number |
| store_memberships | organization_id, store_id, user_id, role, active | role `employee` or `manager`; unique store/user; active org membership required |
| products | organization_id, name, short_name, category, container_type, sku?, plu?, upc?, active | Organization catalog; archive instead of deleting referenced records |
| displays | organization_id, store_id, name, active_pog_version_id?, active | Assigned published POG must belong to same organization |
| pogs | organization_id, name, archived | Reusable organization-wide template identity |
| pog_versions | organization_id, pog_id, version_number, state, reference_path, reference_width, reference_height, published_at?, created_by | state draft/published; unique pog/version; published immutable |
| pog_slots | organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity, refill_threshold?, sort_order | Unique version/label; product same organization; normalized checks below |
| scans | organization_id, store_id, display_id, pog_version_id, created_by, source, status, revision, job_generation, retry_generation_count, crop_json?, image_path?, image_deleted_at?, captured_at?, confirmed_at?, completed_at?, completed_by?, total_refill?, display_score? | source photo/manual; backend created_at is authoritative ordering |
| scan_slots | organization_id, scan_id, pog_slot_id, product_id, product_name_snapshot, slot_label_snapshot, target_snapshot, threshold_snapshot, ai_quantity?, ai_confidence?, ai_flags, accepted_quantity?, review_required, review_state, final_quantity?, refill_quantity? | Unique scan/slot; pinned slot version enforced; original observations immutable after review starts |
| scan_corrections | organization_id, scan_id, scan_slot_id, actor_id, previous_quantity?, corrected_quantity, original_ai_quantity?, reason?, scan_revision | Append-only; preserves human edits including unchanged explicit verification |
| scan_confirmations | organization_id, scan_id, scan_revision, confirmed_by, confirmed_at, total_refill, display_score? | One confirmation per scan in MVP; slot finals frozen in same transaction |
| scan_jobs | organization_id, scan_id, generation, state, attempt_count, available_at, lease_until?, lease_token?, last_error_code? | One job per scan/generation; worker-only access |
| scan_attempts | organization_id, scan_id, generation, attempt_number, provider, model, prompt_version, schema_version, started_at, ended_at?, outcome, latency_ms?, usage_json?, normalized_response? | Append-only attempt evidence; no secrets or signed URLs |
| audit_events | organization_id, store_id?, actor_id?, event_type, resource_id, request_id, metadata | Membership changes, publication, assignment, confirmations, completion, exports/deletions |
| idempotency_records | actor_id, route_scope, key, request_hash, resource_id, response_status, expires_at | Unique actor/scope/key; same key/different body = conflict |
| upload_intents | organization_id, store_id?, actor_id, resource_id, bucket, object_path, expires_at, state, expected_type, max_bytes | Server issues path and confirms object; write-once, never arbitrary client path |

## Coordinate and Quantity Constraints
Top-left origin of the upright, canonical display crop; x and y increase right/down. `0 <= x,y < 1`; `0 < width,height <= 1`; `x + width <= 1`; `y + height <= 1`. Rectangles may touch but cannot overlap with positive area in a published version. Server rechecks this transactionally at publication.

MVP limits: 1–100 slots per POG, quantities 0–999, targets 1–999, threshold null or 0–target, confidence null or finite 0–1. Current counts may exceed target. Invalid input is rejected, not silently clamped. Product and slot display names are copied into scan_slots at scan creation so later renames do not rewrite history.

## Additional State Fields
`scan_slots.review_state` is pending or verified. Initialize pending for every manual or required-review slot; high-confidence slots may remain pending but do not block overall confirmation when review_required is false. accepted_quantity initially copies a valid AI estimate, otherwise null. Human edits update accepted_quantity; AI fields remain unchanged. Jobs use queued/running/succeeded/failed/cancelled states; upload intents use pending/validated/rejected/expired. Scan states are defined in scan-lifecycle.md. POG reference_width/reference_height refer to the canonical saved crop, not the original upload. Store scan crop_json and source dimensions with the scan; retain canonical processing dimensions and input hashes in scan_attempts for reproducibility.

## Lifecycle and Integrity
Scan creation locks display assignment, verifies active entities and membership, and copies all slot metadata in one transaction. Published POG changes require a new version. Draft replacement of reference image invalidates coordinates until explicitly reviewed. Products referenced by published versions cannot be hard-deleted. Archived products remain readable in history; publishing with an inactive product is forbidden. Existing active displays with an archived product show an admin warning until a new version is assigned.

Use RESTRICT for historical references, not cascading history deletion. Identity deletion follows a separate redaction process retaining pseudonymous audit identifiers as policy permits. Archived stores/displays block new scans but retain authorized history. Do not delete completed scans through ordinary employee endpoints.

## Indexes
Index scans on `(store_id, created_at DESC, id DESC)`, `(display_id, created_at DESC)`, and `(created_by, created_at DESC)`; memberships on user_id and active; scan_slots/corrections/attempts on scan_id; available jobs on state/available_at with a partial queued index; tenant FKs on organization_id. Design RLS helpers to use these indexes.

## Migration Order
1. Organizations, profiles, memberships, stores and authorization helpers.
2. Catalog, displays, POG versions/slots and constraints.
3. Scan snapshots, corrections, confirmations and domain RPCs.
4. Jobs, attempts, upload intents, idempotency and audit.
5. Private buckets/storage policies and publication/confirmation grants.
6. Synthetic seed and RLS integration fixtures.
This order is implemented in `supabase/migrations/` (feature 02) with one change: the domain functions (`publish_pog_version`, `create_scan`) are in migration 5 because `create_scan` writes upload intents (migration 4). Migration 6 adds row locks that close publication race windows and requires scans to pin a published version. Migration 7 adds the missing `pog_slots(organization_id)` index. Migration 8 (feature 03) adds the membership functions, the admin roster projection, the first-admin bootstrap and an organization-row lock in the last-admin trigger. Step 5's "confirmation grants" arrive with the confirmation function in feature 06 (decision D29); until then no client role can write confirmations.

Migration 9 (feature 04, `…0900_catalog_management.sql`) adds the service-role management functions for stores, products, POG identities and displays (decision D39); it changes no table.

## Implementation Notes (feature 02)
- `pog_versions.created_by` and `published_by` are nullable: null only for synthetic seed rows created without an identity.
- `scan_slots.pog_version_id` duplicates the scan's pinned version so composite foreign keys enforce "slot belongs to the pinned version".
- `scans` has no `revision`-touch trigger: revision changes are explicit in transition functions (features 06/07/09). Other mutable tables bump `revision` and `updated_at` on every update.
- `scan_attempts` adds `input_width`, `input_height`, `input_sha256` (reproducibility); updates are allowed (attempt completion), deletes are not.
- `idempotency_records` adds `response_body` so a replay can return the original result.
- `upload_intents.object_path` is constrained to the organization's own prefix and the documented path shape for each bucket.
- Store `timezone` is validated against the database's IANA zone list by trigger.

## Implementation Notes (feature 04)
- Archiving: stores, displays and products set `active = false`; POGs set `archived = true`. Nothing is deleted through the API. Archived stores and displays block new scans (`create_scan`, unchanged); archived POGs block new display assignments and publication; archived products block publication and flag displays whose assigned version uses them (`has_archived_products`).
- Store numbers are checked case-insensitively per organization inside `create_store`/`update_store`; the existing exact unique constraint backs this up under concurrency.
- A display's store never changes. Restoring a display requires an active store; adding a display to an archived store is refused.
- Every change bumps `revision` (existing touch trigger) only when a value actually changes; a no-op patch returns the current row unchanged.
- Audit events: `store.created|updated|archived|restored`, `product.created|updated|archived|restored`, `pog.created|updated|archived|restored`, `display.created|updated|archived|restored`, and `display.assigned` with before/after version IDs.

## Implementation Notes (feature 05)
- Migration 10 adds `pog_versions.reference_upload_id`, `reference_validated_at`, `slots_need_review`, `source_version_id`; generated TypeScript types come from the applied local schema.
- Canonical `reference_width/height` describe the upright cropped, re-encoded image. A draft clone shares its source POG's immutable reference path and creates fresh slot IDs. Reference paths are scoped to the organization/POG prefix to allow this sharing.
- `create_pog_version` locks the POG row, requires an admin, refuses a second open draft and allocates the next unique version number. Version numbers are reserved at draft creation, then frozen at publication (no renumbering).
- `replace_pog_slots` locks the version, checks revision, validates all supplied slots, replaces them and increments the version revision in one transaction. Failure rolls back the whole set. Slot labels are unique case-insensitively through this write boundary. Overlaps/archived products can be saved as drafts but cannot publish.
- `create_pog_upload_intent`, `finalize_pog_reference`, `settle_pog_upload` are service-role-only, actor/tenant checked. Finalization records immutable output and settles the upload in one transaction. Replacing any image on a draft with slots requires coordinate confirmation at the current revision.
- Publication trigger additionally requires a validated reference and completed coordinate review; geometry/products/targets/thresholds are rechecked with the existing publication/slot/product locks. Published versions/slots remain immutable for every database role.
- Audit includes `pog_version.created`, `pog_version.slots_saved`, `pog_version.reference_set|reference_replaced`, and existing `pog_version.published`. Upload issuance/failed validation is operational state, not a publication event. Existing assignment audits remain Feature 04.

## Implementation Notes (Feature 06)
- Migration 11 (`…1100_refill_engine.sql`) adds no table: private scan snapshot projection and service-role-only `mutate_scan_counts` provide atomic count/correction saving, confirmation, revision checks and committed response idempotency.
- Count saves append correction evidence even for unchanged explicit verification; omitted slots remain unchanged. A save with `verified: false` leaves the edited slot pending, including when previously verified. Original AI observations remain untouched.
- Confirmation locks the parent scan and all slots, uses accepted counts plus pinned target/threshold/product snapshots, stores every final/refill quantity, freezes total/score, inserts one confirmation and audit, then increments revision. Product totals are sums of stored per-slot finals and never consult the current catalog/POG.
- A parent lock on slot writes serializes them with confirmation; insertion into a confirmed/completed scan is refused. The existing scan history guard now also rejects clearing a confirmed timestamp to null.

## Implementation Notes (Feature 09)
- Migration 14 (`…1400_vision_pipeline.sql`) adds `scans.failure_code` (present exactly when `status = 'failed'`), `scans.ai_summary` (immutable once set), `scans.manual_takeover_at/by`, and replaces the photo-only image check with `scans_image_source_check` so a taken-over scan keeps its image while `source = 'manual'`.
- `scan_attempts` adds `job_id`, `lease_token` (unique per job), `error_code`, `policy_version`, `confidence_threshold`, and outcome `input_error`. Attempts remain undeletable; jobs and attempts have no client grant.
- New service-role functions: `claim_scan_job`, `heartbeat_scan_job`, `finish_scan_attempt`, `scan_analysis_action`; private helper `fail_scan_job`. Audit events: `scan.analysis_completed`, `scan.analysis_failed` (no actor), `scan.analysis_retried`, `scan.manual_takeover`.

## Implementation Notes (Feature 10)
- Migration 15 (`…1500_review_corrections.sql`) adds nullable `scan_corrections.verified`: `true`/`false` for every row written by `mutate_scan_counts` from Feature 10 on, `null` only for earlier rows (no fabricated history). `mutate_scan_counts` is otherwise unchanged (diffed against migration 11).
- `private.guard_scan_slot` now also refuses clearing `review_required` (true → false) while the scan is `needs_review`; setting it true stays allowed because manual takeover does so after moving the scan to review. AI observation, snapshot and confirmed-slot immutability are unchanged. The rule applies to every role, including service role and database owner.

## Implementation Notes (Feature 11)
No migration. History uses the existing `scans (store_id, created_at desc, id desc)` index and RLS. Display, store and POG template names in history are current labels; product names, slot labels, targets, thresholds, the pinned version number and confirmed results come from scan snapshots / the immutable version (D74).


## Shared prep ledger and quick stock counts (migrations23–27)
production_prep_events: scoped org/store/product foreign keys; quantity1…9999, actor_id, created_at and ordered identity sequence; RLS enabled, service-only insert/read and append-only mutation guard.
production_counts adds immutable prep_revision and stock_round. A count captures which earlier prep is already included and which shared stock round it belongs to.
production_checks adds abandoned status and kind=section|product. Product counts are atomic per-product snapshots across all locations; section drafts keep their existing actor/day uniqueness. Finished/abandoned counts remain immutable.
production_events adds check.abandoned; quick product publications record actor/time and physical HAVE/backup. The existing manager event view includes these records.
Current prep reads latest counts per product and section across dates. Archived items/products are excluded; incomplete/mismatched groups are explicitly not ready. Old section-day reads exclude product-kind checks for compatibility. No existing scan/POG tables were changed.

### Waste ledger and reports

`production_waste_events` (migration 29) stores immutable `waste` and `void` events scoped to organization/store/product, with positive quantity, selected business date, reason/note, product-name/category/type snapshots, actor and actual timestamp. Unique `void_of` permits one reversal; a trigger requires reversal identity/quantity/date/snapshot fields to match the original. Browser roles have no direct access. Server-only `production_operations_read` and `production_waste_record` recheck memberships. Made reporting uses the existing prep ledger; waste is net of reversals. No sales quantities or inferred stock changes are introduced.

### POG kind (migration 30)

`pogs.kind` is one of the four production sections (`fruit_mobile`, `salad_mobile`, `fruit_case`, `veggie_case`). It is nullable only so POGs created before the migration keep working; `POST /pogs` requires it and `PATCH /pogs/:id` can set it but never clear it. `create_pog` gains a trailing `p_kind` and `update_pog` accepts `kind`; both validate through `private.clean_pog_kind` and record kind in audit metadata. Displays expose it as `active_pog.pog_kind`. A version's "updated" date in the UI is its `published_at`; the Displays page flags a display whose POG has a newer published version and offers a one-click reassignment through the existing display PATCH.
