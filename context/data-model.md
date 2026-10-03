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
This order is implemented in `supabase/migrations/` (feature 02) with one change: the domain functions (`publish_pog_version`, `create_scan`) are in migration 5 because `create_scan` writes upload intents (migration 4). Migration 6 adds row locks that close publication race windows and requires scans to pin a published version. Migration 7 adds the missing `pog_slots(organization_id)` index. Step 5's "confirmation grants" arrive with the confirmation function in feature 06 (decision D29); until then no client role can write confirmations.

## Implementation Notes (feature 02)
- `pog_versions.created_by` and `published_by` are nullable: null only for synthetic seed rows created without an identity.
- `scan_slots.pog_version_id` duplicates the scan's pinned version so composite foreign keys enforce "slot belongs to the pinned version".
- `scans` has no `revision`-touch trigger: revision changes are explicit in transition functions (features 06/07/09). Other mutable tables bump `revision` and `updated_at` on every update.
- `scan_attempts` adds `input_width`, `input_height`, `input_sha256` (reproducibility); updates are allowed (attempt completion), deletes are not.
- `idempotency_records` adds `response_body` so a replay can return the original result.
- `upload_intents.object_path` is constrained to the organization's own prefix and the documented path shape for each bucket.
- Store `timezone` is validated against the database's IANA zone list by trigger.
