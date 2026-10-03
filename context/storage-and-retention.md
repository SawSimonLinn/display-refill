# Storage and Retention

## Buckets and Paths
Private `display-scans`: `{organization_id}/{store_id}/{scan_id}/capture.jpg`.
Private `pog-images`: `{organization_id}/{pog_id}/{version_id}/reference.jpg`.
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
