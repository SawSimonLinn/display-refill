# Operations Runbook

## Deployment Shape
Deploy Next.js API/admin, a continuously running scan worker, and daily cleanup scheduling against the same environment's Supabase project. Hosting vendor is an open decision; the worker cannot rely on process memory surviving a web request. Use least-privilege operational credentials where supported. Keep production auth redirects explicit and separate from staging.

## Release Sequence
Back up and verify recovery access; apply backward-compatible migration; deploy API and worker accepting current schema; deploy web and TestFlight build; run a controlled manual and photo scan; inspect authorization and job metrics. Record migration version, app version, provider/model, prompt version and rollback steps. Do not send real employee photos to a provider until its data handling and project access are approved.

## Observability
Structured logs contain request_id, scan_id, job generation/attempt, status, duration and sanitized error code. No credentials, signed URLs, image bytes, personal email addresses, or raw provider prompts in logs. Track queue age, lease recovery, provider errors, processing p95, cost/usage per scan, correction rate, unknown rate and storage cleanup backlog. Initial alerts: oldest due queue item >2 minutes, provider failures >20% over 10 minutes with sufficient traffic, cleanup failure >24 hours. Tune during pilot.

## Recovery
- Provider outage: disable new AI submissions if needed; offer manual takeover. Jobs remain bounded by retry budget; no infinite retry loop.
- Worker outage: restart worker; expired leases are reclaimable. Verify queue draining and stale-token rejection.
- Invalid credentials/config: stop attempts with explicit configuration error; repair secret; authorized explicit retry within budget.
- Storage upload missing: keep awaiting_upload until timeout; manual fallback or a new scan.
- Database unavailable: preserve visible unsaved draft in memory and explain connectivity requirement. Do not pretend a list was saved.
- Bad release: roll back app/worker version if compatible; avoid destructive migration rollback. Restore into an isolated environment when needed, reconcile Storage references and job leases before resuming.
- Membership incident: revoke database memberships and Auth session as appropriate; existing short-lived image links may persist until expiry.

## First Admin Bootstrap (operator only)
Run once per new organization, from an operator machine, never from the app. There is no "first user becomes admin" path.
1. Confirm the target project and that its Auth settings match the checklist below.
2. Export `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret; do not paste into shared shells or logs) and `APP_ORIGIN` (the admin web origin the invitation links to).
3. `node scripts/bootstrap-admin.mjs --email owner@example.com --org-name "Org name"` (or `--org-id <uuid>` for an existing organization with no active admin). For a non-loopback `SUPABASE_URL` add `--confirm-remote <that hostname>`; the script refuses otherwise.
4. The script invites the identity (or reuses an existing one), then calls `bootstrap_first_admin`, which refuses an organization that already has an active admin and writes audit event `membership.bootstrapped` (no actor). On failure it deletes an identity it just created.
5. The owner accepts the invitation email, chooses a password and invites everyone else from Members.
Verified only against the local stack (`tests/api/test/bootstrap.test.ts`). Not yet run against any hosted project.

## Auth Configuration Checklist (per hosted project)
Local values live in `supabase/config.toml`; hosted projects must be set by an operator and are **not** changed by any script here:
- Public signup disabled; email provider enabled; anonymous sign-ins and other providers disabled.
- Site URL = the admin web origin; redirect allowlist = exactly `<APP_ORIGIN>/auth/confirm`. Supabase accepts any path on the site URL host, so the site URL must be the app's own domain.
- Invite and recovery templates from `supabase/templates/` (token-hash links to `/auth/confirm`).
- Minimum password length 12; refresh-token rotation on; a real SMTP provider with its own sending limits.
- After configuring, run an invite and a reset against staging and record the result. Hosted email delivery is unverified so far.

## Membership Incident
Revoke via Members (or `PATCH /api/v1/members/:user_id` with `active: false`). The next API request and page load with an existing token are denied (403 / `/no-access`). To also end the person's Auth sessions, remove or ban the user in the Supabase dashboard. Image links already issued stay valid until expiry (feature 08).

## Retention / Backup
Run cleanup in batches, record deletion outcome, retry safely, and show deleted-image state in history. Before pilot, define backup schedule, restore owner, recovery objectives and backup expiry with the chosen Supabase plan; do not assume a particular backup feature exists. Exercise a restore including image-reference consistency. Corrections and metadata retention must match the approved policy.

## Pilot Support
Owner records the on-call contact and store support channel before TestFlight distribution. Provide staff instructions: select correct display, face it straight on, avoid people, verify hidden stock, confirm counts, record completion only after refilling. No medical/food-safety decisions are delegated to the app.

## Feature 12 Startup and Operator Commands (local foundation)
Use Node 22 and `npm ci`. API: fill `apps/admin/.env.local` from the environment-specific `.env.example`; `npm run build:admin`, then `npm run start -w @display-refill/admin`. Worker: fill `workers/scan-worker/.env`, `npm run build:worker`, then `npm run start -w @display-refill/scan-worker`. API and worker must target the same project. API instrumentation and worker exit 78 for invalid configuration. Validation reports variable names/rules, never values. Never paste secrets into evidence or command-line arguments. `--once` is a **synthetic adapter self-check**, not a queue/provider readiness check. DATABASE_URL is validated but worker operations use Supabase RPC/Storage, not a direct SQL connection.

After applying migration `20261003001700`, operator SQL (privileged environment connection only):
```sql
update public.operation_settings set vision_enabled=false, updated_at=now() where singleton;
-- Re-enable only after resolving the outage:
update public.operation_settings set vision_enabled=true, updated_at=now() where singleton;
```
No user-facing control or client grants exist. Switch blocks new photo creates, enqueues and claims, including retry generations. Existing in-flight calls may complete within the 45-second deadline. Employees can create manual scans or take over queued/failed photo scans. Disabled finalize returns a sanitized 503 with manual guidance; the upload remains available for a later retry within its policy window.

From `workers/scan-worker`, run `npm run start -- --metrics` for service-only aggregate JSON metrics, or `npm run start -- --cleanup` for one batch (default 100, maximum 1000). `WORKER_CONCURRENCY` defaults to two (range 1–16); Postgres independently limits live jobs to two per store. Cleanup leases last five minutes; process serial deletions with enough scheduler/runtime time for a batch. If interrupted, rerun after lease expiry. A failed DB finish leaves the lease reclaimable; do not manually mark deletion success. Storage absence is success, Storage errors are retries. Expired queued/processing images are fenced by generation/job cancellation and failed with IMAGE_UNAVAILABLE before cleanup; an already running bounded provider call may finish externally, but its result cannot commit. Manual takeover remains available. Inspect `image_cleanup_jobs` for outcomes/backlog and `scan_attempts`/`scan_jobs` for retry/error evidence. Do not export paths or attempt content into logs.

Metrics include oldest due queue age, queued jobs, expired leases, recovered leases, retries, failed scans, ten-minute attempt/failure denominators, 24-hour processing p95 and recorded cost in microdollars, AI unknown-slot denominator, corrections and cleanup backlog/age. Mock usage is synthetic or absent; these are recorded counters, **not verified provider billing**. Cost has no monetary estimate when the adapter reports no cost. Initial alarms remain proposals: due age >120 seconds; provider failure ratio >20% with owner-approved minimum sample size; cleanup oldest >24 hours. Wire metrics to the chosen host monitor and rehearse alert delivery on staging; no monitor/alert service has been provisioned.

## Scheduling, Deployment and Rollback (not executed remotely)
After approving retention and hosting: run cleanup daily as a separate single-shot process with the same environment's credentials, `--approved-retention --confirm-project=<exact Supabase hostname>` for non-loopback targets. These flags are an operator assertion, not evidence of owner approval. Never install that schedule before approval. Scheduler must retry nonzero exit, retain sanitized outcomes, prevent overlapping invocations where practical, and run additional bounded batches until backlog drains. Concurrent invocations are lease-fenced; batch size and retry times cap pressure. Metrics collection is read-only and may run more often. There is no destructive schedule in this repository.

Choose API host, persistent worker host, scheduler, secret manager, trusted ingress proxy and monitoring owner. Ensure proxy replaces spoofed forwarding headers before using client-IP limits. Shared auth rate windows survive process restart; HMAC keys rotate with the service secret (windows reset on rotation). Supabase Auth still has separate quotas. Per-store leases do not cap total fleet/provider throughput: set replica count × WORKER_CONCURRENCY within the approved global provider/cost ceiling; real provider is not yet enabled. Use separate projects/secrets/redirects for local, staging and production.

Deploy additive migration first, then compatible API/worker artifacts; record schema/artifact versions. Stop cleanup and disable vision before rollback; let bounded running calls finish or expire. Roll back artifacts only if they accept the current schema; leave additive tables/functions intact. Older API artifacts have process-only auth throttles: retain external throttling or restore the new API before multi-instance operation. Never reverse by dropping retained metadata or manually clearing fences. Reconcile pending jobs, retries and cleanup leases before resuming. Staging release, actual independent-host recovery, alert delivery and rollback remain unperformed.

## Backup and Restore Responsibilities (not rehearsed against hosting)
Before deployment the owner must select plan-supported database backup/export capability, encrypted private Storage object backup, access owner, frequency, expiry, RPO/RTO and cost ceiling. Database dumps alone do not contain Storage bytes. Record object manifests/checksums and backup timestamps without signed URLs; restrict access as for live media. Decide whether restored images deleted by live retention must be removed before users regain access and how expired backups are destroyed. Metadata/correction/audit expiry requires separate approval; no such sweep exists.

Restore drill: pause API writes, workers and schedules; restore database and matching private objects into an **isolated** project; verify migrations, Auth identities/membership restrictions, bucket privacy, each live reference's object/checksum, deleted-image state, retained counts/corrections/audit and immutable POG snapshots. Do not resurrect expired images into serving paths. Reconcile running leases (allow expiry/reclaim), canceled generations and pending cleanup; exercise a synthetic manual scan, photo scan, takeover and authorized history/410 before enabling access. Record measured data loss/recovery time against RPO/RTO and obtain restore-owner signoff. This session exercised local lease/deletion recovery only; it did not create backups, restore a database/Storage snapshot, rehearse staging rollback or verify a hosted backup plan.
