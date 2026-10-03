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
