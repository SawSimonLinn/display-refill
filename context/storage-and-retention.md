# Storage and Retention

## Buckets and Paths
Private `display-scans`: `{organization_id}/{store_id}/{scan_id}/capture.jpg`.
Private `pog-images`: `{organization_id}/{pog_id}/{version_id}/upload-{upload_id}.jpg` staging, promoted to `reference-{upload_id}-{sha256}.jpg` after validation. Published clones may share the source POG’s reference object.
Store bucket/path separately in metadata. Reference images are immutable after publication. Never accept a public image URL as the source of truth. Private buckets enforce access controls; time-limited signed links enable authorized reads. See [Supabase bucket documentation](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Upload Pipeline
1. Create authorized resource and exact upload intent server-side.
2. Issue short-lived upload authorization bound to that object path (initial TTL 10 minutes).
3. Client normalizes orientation, strips EXIF/location metadata, and transcodes to JPEG. Suggested long edge 2048 pixels while preserving aspect ratio.
4. Upload at most 10 MiB; do not overwrite an existing object.
5. Finalize checks object ownership, actual decoded image format, dimensions (maximum 4096 per edge and 16 megapixels), and size. If necessary server re-encodes to remove metadata and promote to an immutable validated object; provider only receives validated image bytes.
6. Enqueue only after validation succeeds. Reject malformed, oversized, or mismatched content and delete rejected uploads.

Client preprocessing is convenience, not a security boundary. Validate at the server even when bucket MIME and size limits exist. Imported HEIC photos must be converted on device; reject unsupported formats clearly. Retake creates a new scan rather than overwriting the old image.

## Retention Defaults (Product Proposals)
- Raw scan images: 90 days from scan creation.
- Scan counts, corrections and audit: 12 months initially, subject to owner approval before pilot.
- Published POG reference: retain while assigned or referenced by retained scans.
- Abandoned upload objects: remove after 24 hours.
- Provider request content retention: verify provider terms/configuration before real store photos are sent.

A daily scheduled worker job deletes expired objects idempotently and records image_deleted_at. Metadata history remains until its own policy expires. Handle “already absent” as success; retry actual storage failures and alert on backlog. No hidden indefinite copy in exports, logs, or backups is assumed; document backup expiry as part of the operational policy.

## Future Training
Do not automatically export or train on corrections. Admin-controlled export is a later feature and must honor image retention and organizational permission. The MVP stores provenance and export eligibility fields only if policy is approved; default eligibility is false. A retained count without its deleted image remains useful for audit but cannot train image recognition. Avoid people in capture framing; provide retake guidance when people block the display.

## Implemented Reference Upload (feature 05)
The POG browser accepts JPEG/PNG/WebP, previews EXIF-upright pixels, offers quarter-turn rotation and numeric/draggable display bounds, and converts non-JPEG or oversized inputs to JPEG when possible. HEIC is not supported by this web workflow. The **server** accepts JPEG bytes only: 10 MiB, maximum 4096 per edge / 16 million pixels, crop at least 64 px per edge. It decodes, normalizes EXIF plus admin rotation, crops, scales to at most 2048 on the long edge and re-encodes without metadata.

POG uploads use a ten-minute, actor-bound authenticated API endpoint that streams to the private exact staging path without overwrite. This differs from the proposed direct signed-upload pipeline because Supabase’s signed upload tokens last two hours. Finalize checks intent, draft state/revision, ownership and expiry, writes a content-addressed output without overwrite, then records validation transactionally. Same-byte upload retries are safe; finalize uses normal JSON idempotency. Rejected/expired staging objects are removed immediately; successful staging objects are removed after promotion. Cleanup failures are logged without signed URLs or image data.

Concurrent outputs that lose a revision race and replaced draft references are retained for Feature 12’s unreferenced-object cleanup; no retention worker is built here. Cleanup must consult every version that shares an object, plus assignment/history retention. Validated/published image objects are never overwritten or removed by editor operations. Publication refuses a missing validated Storage object. Scan-photo capture/upload/finalization remains **unimplemented Feature 08**.
