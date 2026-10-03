# Progress Tracker

## Current Phase
Phase 0 — Foundation. Features 04–06 implemented and verified on the local stack (database, API, web dashboard). Feature 07 implemented with local backend and actual Swift client verification, but iOS acceptance remains open. Feature 03 verified locally (iOS logic on macOS only). Feature 02 complete locally. Nothing has been applied to a hosted project. **The iOS build (simulator/device) is still unverified** (no Xcode, E01/E02); Feature 07 does not close that gap.

## Current Goal
Verify Feature 07 on the actual iOS target, simulator/device and assistive technologies before treating its acceptance criteria as complete. Manual implementation and local client/backend checks are available; live vision remains out of scope.

## Completed
- Reworked the seven uploaded reference documents for this project.
- Defined data, API, authorization, scan state, vision, refill and retention contracts.
- Added incremental feature specifications and pilot acceptance criteria.
- Prepared a documentation index, examples and ZIP delivery.
- Feature 01 repository foundation (details and evidence below).
- Feature 02 database, constraints and security (details and evidence below).
- Feature 03 Supabase Auth and memberships (details, evidence and limitations below).
- Feature 04 store, display and product management (details, evidence and limitations below).
- Feature 05 POG builder, reference-image validation and publication (details, evidence and limitations below).
- Feature 06 authoritative backend refill engine, atomic count saving and confirmation (details, evidence and limitations below).

## In Progress
Feature 07 iOS target/device, actual app-relaunch and accessibility acceptance verification (blocked by unavailable Xcode/iOS runtime).

## Feature Status
| Feature | Status | Evidence |
| --- | --- | --- |
| 01 Foundation | Implemented; iOS build unverified | TS checks pass (below); Swift compiled for macOS only |
| 02 Database and security | Complete (local) | 88/88 DB tests on a from-empty instance, acceptance audit, lint fixed (below) |
| 03 Supabase Auth | Implemented; verified locally (iOS on macOS only) | DB 105/105, API 43/43, unit 54/54, Swift 28/28 + 3 live; browser pass (below) |
| 04 Store/display/product management | Implemented; verified locally (no iOS client yet) | DB 120/120, API 59/59, unit 66/66, browser pass, 2 negative controls (below) |
| 05 POG builder | Complete locally; accessibility/device gaps explicit | Migration 10, DB 120/120 regressions, API 70/70 (11 new real-workflow tests), unit 95/95, Chromium workflow/viewport checks (below) |
| 06 Refill engine | Complete locally (backend only) | Migration 11; unit 110/110, DB 120/120, API 79/79; authorization, concurrency, retry and frozen-history evidence below |
| 07 Manual iOS workflow | Implemented; iOS acceptance incomplete | Migration 12; DB 120/120, API 80/80, TS units 110/110; Swift macOS compile/model tests and actual local HTTP workflow pass. iOS build/relaunch/VoiceOver/Dynamic Type unverified |
| 08 Photo capture/storage | Not started | Feature spec only |
| 09 Vision pipeline | Not started | Mock adapter only; provider unselected |
| 10 Review/corrections | Not started | Feature spec only |
| 11 History/admin review | Not started | Feature spec only |
| 12 Operations/retention | Not started | Runbook only |
| 13 Pilot/release | Not started | No store trial |

## Feature 01 — What Exists
- Monorepo (npm workspaces): `apps/admin`, `packages/domain`, `packages/server`, `workers/scan-worker`, `apps/ios`, `supabase/` (empty), `scripts/`. The pre-existing create-next-app scaffold was moved into `apps/admin`. The context index that sat at the root `README.md` moved to `context/README.md`, where its relative links resolve. A new root README covers setup.
- `packages/domain`: response envelopes, stable error codes with HTTP statuses, snake_case key checker, quantity/confidence primitives, scan status/source/reason enums, strict vision schema v1, Supabase secret-key detector, JSON fixtures (health, error, vision copy of `examples/vision-response.json`).
- `packages/server`: admin and worker configuration validation (messages name variable + rule, never value), redacting JSON-lines logger, request-ID and envelope helpers (`no-store`), `VisionAdapter` interface, strict output validator, `MockVisionAdapter`.
- `apps/admin`: `GET /api/v1/health`, JSON 404 for unknown `/api/v1/*`, startup config validation via `instrumentation.ts`, `server-only` config module, semantic light/dark tokens (light default), navigation shell (Stores, Displays, Products, POGs, Scans, Members), disabled store filter, "not built yet" placeholders, disabled sign-in placeholder, development banner.
- `workers/scan-worker`: config validation (exit 78), `--once` self-check through the mock adapter and validator, idle lifecycle with clean SIGINT/SIGTERM shutdown. No job queue.
- `apps/ios`: XcodeGen `project.yml` (iOS 17.0), Info.plist with camera purpose string and public config keys, xcconfig with git-ignored local override, `DisplayRefillKit` package: `AppConfiguration` validation (rejects secret keys and bundled server variables), wire models with explicit CodingKeys, RFC3339 coding, `APIClient` protocol + URLSession and mock clients, SwiftUI sign-in placeholder with server reachability check, Check/History tab shell with empty states, configuration-error screen, swift-testing suite. `scripts/swiftc-check.sh` fallback.
- Docs updated: root README, apps/ios/README.md, supabase/README.md, decision-log D14–D20, api-contracts (implemented conventions + health), development-setup, current-issues E01–E06, feature spec status.

## Feature 01 — Verification (2026-10-03, macOS 26.2 arm64, Node 22.13.1, npm 11.18.0)
| Command | Result |
| --- | --- |
| `npm run check` (clean `.next`/`dist`) | Exit 0: typecheck 4/4 workspaces, ESLint 0 problems, Vitest 38/38 (domain 14, server 18, worker 3, admin 3), `next build` OK, worker esbuild bundle OK, client-config check OK |
| `npm run build -w @display-refill/admin` / `-w @display-refill/scan-worker` | Each builds independently |
| Admin build with sentinel secrets in env, then `CHECK_SENTINELS=… npm run check:client-config` | 0 matches in 13 browser-bundle files and 4 iOS config files. Positive control (`CHECK_SENTINELS=Members`) correctly failed |
| `next start` with only `SUPABASE_SERVICE_ROLE_KEY` set; `curl /api/v1/health` | 503 `CONFIGURATION_INVALID`, `no-store`, request ID; log listed the 4 missing variable names; secret value absent from log |
| `next start` with valid placeholder env | health 200 with `not_checked`/`not_implemented` checks, client `x-request-id` echoed; `POST /api/v1/scans` → JSON 404; `/`, six section pages and `/sign-in` → 200; `/nope` → 404. Screenshots of `/stores` and `/sign-in` reviewed |
| `node dist/main.js --once` with empty env | Exit 78; message lists 3 missing variables |
| Same with malformed `DATABASE_URL` + `VISION_PROVIDER=openai` | Exit 78; names + rules only, injected values absent |
| Same with valid env | Exit 0; "self-check passed", provider mock, 2 slots, 1 unknown |
| Persistent worker + SIGTERM after 2 s | started → shutdown requested → stopped, exit 0 |
| `apps/ios/scripts/swiftc-check.sh` (with CLT workaround flags, see current-issues E02–E03) | Core, UI, app entry compiled for macOS 14 with Swift 6 and `-warnings-as-errors`; 11/11 swift-testing tests passed |

Bugs found and fixed while verifying: a malformed `APP_ORIGIN` threw `TypeError: Invalid URL` instead of a configuration error (Zod runs refinements after a failed URL check); config errors lacked public initializers needed by the UI; `#Preview` required Xcode's macro plugin (replaced by `PreviewProvider`).

## Feature 01 — Unverified / Remaining
- **iOS build not run**: no Xcode, so no `xcodegen generate`, no iOS SDK compile, no simulator, no device. The Swift code was compiled only for macOS; iOS-only behavior (UIKit colors, Info.plist expansion, xcconfig `$()` URL handling) is untested.
- **iOS target not checked against store devices**: iOS 17.0 is provisional (D16).
- `swift build`/`swift test` through SwiftPM not run (broken CLT, E02).
- ~~No Supabase project or local stack~~ — local stack added in feature 02. The admin API and worker still do not connect to it; config validation only checks shapes.
- Dark theme tokens defined but not visually reviewed (light is the default, no toggle). Contrast not measured.
- ESLint covers `apps/admin` only; the packages and worker rely on strict `tsc`.
- No authorization tests: there is no authenticated surface yet (feature 02/03).
- npm audit dev-only findings (E06).

## Feature 02 — Dependency Check
Feature 01 is the only dependency. Its TypeScript foundation (config validation, domain/server packages, test tooling) is verified. Its open item is the iOS build (no Xcode). Feature 02 is database-only and does not use the iOS app, so that item does not block it.

## Feature 02 — What Exists
- Tooling: Supabase CLI 2.119.0 (root devDependency), `supabase init` config (`project_id = "display-refill"`, public signup off, realtime/edge runtime/analytics off), Colima 0.10.3 + Docker CLI 29.8.2 installed with Homebrew, local Postgres 17.
- Migrations (`supabase/migrations/2026100300{01..07}00_*.sql`), in data-model order (06 and 07 are follow-up fixes, see the later verification sections): all 19 tables from data-model.md with composite tenant foreign keys, check constraints for coordinates/quantities/thresholds/confidence/flags, indexes from data-model.md; `private` helpers (`is_org_admin`, `is_org_member`, `accessible_store_ids`, `has_store_access`, `is_store_manager`, `is_org_manager_or_admin`, `visible_pog_version_ids`); SELECT-only RLS policies matching the permission matrix; triggers for publication validation (1–100 slots, active products, no positive-area overlap), published immutability, display→published-only assignment, scan/scan-slot history guards, append-only corrections/confirmations/audit, last-active-admin, profile creation on `auth.users` insert, IANA time zone; private `display-scans` and `pog-images` buckets (JPEG, 10 MiB, no object policies); grants revoked from `anon`/`authenticated` including default privileges; `publish_pog_version` and `create_scan` (service role only).
- `supabase/seed.sql`: two synthetic organizations (A: 2 stores, B: 1 store), products incl. one inactive and one draft-only, published A v1 / B v1, draft A v2, four displays (one unassigned). No users.
- Generated types: `packages/server/src/database.types.ts`, exported as `Database` from `@display-refill/server`.
- `tests/db` workspace (vitest, supabase-js, pg): reads, direct writes, constraints/immutability, trusted functions, storage, schema catalog invariants, concurrency (two raw connections interleaving publication with slot/product writes), sessions (live-token revocation, expired/forged tokens, in-org store boundaries). Users are created per run (admin A, manager A1, employee A1, employee A2, admin B, revoked store membership, revoked org membership, outsider).
- Scripts: `db:start|stop|reset|types|types:check`, `test:db`, `check:db`, `check:db-scripts`; `scripts/check-db-types.mjs`, `scripts/check-db-scripts.mjs`.
- Docs: supabase/README.md, root README, decision-log D21–D28, data-model implementation notes, api-contracts (database functions), auth-and-permissions (implementation), current-issues E05 resolved, E07–E08 added.

## Feature 02 — Verification (2026-10-03, local Supabase on Colima)
| Acceptance criterion | Command / evidence | Result |
| --- | --- | --- |
| Fresh DB migrates and seeds reproducibly | `npm run db:reset` twice; `supabase db dump --local --schema public,private` and a seed-row digest after each | Both resets succeed; schema dump (1,979 lines) and seed digest byte-identical |
| Cross-store/cross-org reads fail under real authenticated roles | `npm run test:db` → `rls-reads.test.ts` (signed-in users via `signInWithPassword`) | Pass: per-role store/display/catalog/version/scan/slot visibility, ID substitution returns nothing, revoked store/org membership and no membership see nothing, profiles and memberships not exposed across orgs, audit admin-only, anon 42501 on all 19 tables |
| Direct privileged writes fail | `direct-writes.test.ts` | Pass: role self-escalation, admin direct table writes, counts/refill/confirmation/correction/audit/job writes, scan delete, trusted-function calls by authenticated/anon all 42501; rows verified unchanged; public signup rejected |
| Invalid coordinates, fractional counts, invalid thresholds, mismatched tenant FKs fail | `constraints.test.ts` (service role, so RLS is not what stops them) | Pass: 6 coordinate cases, 6 quantity/threshold cases, 7 scan-slot observation cases incl. NaN, 9 tenant, assignment, path and timezone cases |
| Anonymous access to both private buckets fails | `storage.test.ts` | Pass: anon list/download/signed URL/upload/public URL fail for both buckets; signed-in employee and org admin also cannot read, write, overwrite or delete objects directly |
| Published rows cannot be edited | `constraints.test.ts` | Pass: published slot update/insert/delete, moving a slot into a published version, version edit/unpublish/delete, creating a version as published all rejected for the service role; slot update rejected for the database owner too |
| Generated TS types match the applied schema | `npm run db:types:check` | OK; negative control (appended line) detected |
| No production reset commands in scripts | `npm run check:db-scripts` | OK across 6 manifests; negative control (`supabase db reset` without `--local`) detected |
| Trusted functions | `functions.test.ts` | Pass: publish success + audit, overlap/no slots/inactive product rejected with draft unchanged, revision conflict, double publish, FORBIDDEN for manager/employee, NOT_FOUND cross-org/revoked; create_scan manual/photo shapes and snapshots, NOT_FOUND for 5 non-authorized actors, POG_NOT_ASSIGNED, POG_CHANGED, bad source, snapshot survives product rename |
| Schema-wide invariants | `catalog.test.ts` | Pass: RLS on every public table, anon no table privileges, authenticated SELECT-only, no public function executable by clients, definer functions pin search_path, new tables get no client grants |
| Totals | `npm run check:db` (reset + types check + tests) | Exit 0; 6 files, 75/75 tests. A second `test:db` without reset also 75/75 |
| Regression | `npm run typecheck`, `npm test`, `npm run build`, `check:client-config`, `check:db-scripts` | All exit 0 (unit tests 38/38). `npm run lint` fails: E08 |

Defects found and fixed during verification: `assert_publishable` was not executable by `service_role` after the blanket revoke (publishing failed with 42501); the audit `event_type` pattern rejected `pog_version.published`; `[auth.email] enable_signup = false` disabled email sign-in entirely (signup is now blocked only by `[auth] enable_signup = false`, and a test proves signup is rejected).

## Feature 02 — Re-verification (2026-10-03, second session, local Supabase on Colima)
Re-ran every check from scratch instead of relying on the table above, then reviewed the migrations for gaps.

| Check | Command / evidence | Result |
| --- | --- | --- |
| Baseline before changes | `npm run check:db` | Exit 0; 6 files, 75/75 |
| Publish race (new test first) | `tests/db/test/concurrency.test.ts`: connection 1 opens `publish_pog_version` without committing; connection 2 inserts an overlapping slot into the same draft; connection 1 commits | **Defect reproduced**: the slot committed into the published version (overlap and immutability bypassed). `guard_pog_slot` read the version state without a lock; the FK check only waited for the publisher |
| Scan pinned to draft | Same file: direct `scans` insert with `pog_version_id` = draft A v2 | **Defect reproduced**: insert succeeded. `create_scan` never does this, but the database did not forbid it |
| Fix | `supabase/migrations/20261003000600_publication_locks.sql`: slot guard locks the version row(s) `FOR SHARE` before reading state; `assert_publishable` locks slot products `FOR SHARE`; `scans_guard_pin` trigger requires a published version on insert | — |
| Fix verified, with negative control | Concurrency tests with migration 06 applied vs. temporarily removed (fresh reset each) | With 06: 4/4. Without 06: 3 fail (slot race, concurrent product archive, draft pin); the 4th (slot committed before publish waits) passes either way and stays as a regression guard |
| Full DB suite | `npm run check:db` | Exit 0: 6 migrations applied, types check OK, 7 files, **79/79** |
| Reproducible migration | `db:reset` twice, `supabase db dump --local --schema public,private` after each | Dumps byte-identical (2,015 lines) |
| Types | `npm run db:types:check` | OK; migration 06 changes only `private` functions and a trigger, so generated `public` types are unchanged |
| Regression | `npm run typecheck`, `npm test`, `npm run build`, `check:client-config`, `check:db-scripts` | All exit 0; unit tests 38/38 (3 + 14 + 18 + 3) |
| Lint | `npm run lint` | Exit 2: still E08 (`Cannot find module …/eslint-config-next/core-web-vitals`); unrelated to feature 02 |

Hosted-project note: `.env.local` now names a hosted Supabase URL (`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`). No command in this session used it: DB tests read connection details from `supabase status` and refuse non-loopback hosts, and every reset used `--local`. Whether migrations 01–05 were ever pushed there is unknown. Migration 06 was added as a new file, rather than by editing 02, so an already-migrated hosted database can take it forward.

## Feature 02 — Final Verification (2026-10-03, third session)

### E08 lint fix
| Check | Evidence | Result |
| --- | --- | --- |
| Cause | `apps/admin/package.json` had `eslint-config-next` `^14.2.35`; installed 14.2.35 (`apps/admin/node_modules`); `next` is 16.3.8 (root `node_modules`, lockfile); `eslint.config.mjs` imports `eslint-config-next/core-web-vitals` and `/typescript`, the flat-config entry points documented in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`. v14 has no such entry points | Mismatch confirmed |
| Fix | `npm install -w @display-refill/admin --save-dev --save-exact eslint-config-next@16.3.8` (peer: eslint >= 9; installed 9.39.5) | Manifest diff: that one line. Lockfile: 53 packages added, 33 removed, 0 version changes, all in the ESLint toolchain; next/react/supabase/typescript/vitest/pg untouched |
| Lint | `npm run lint`; `eslint -f json .` | Exit 0; 23 files, 0 errors, 0 warnings |
| Lint positive controls | Temporary probe files in `apps/admin/src/app` (deleted after) | `any` → `@typescript-eslint/no-explicit-any` error; `<img>` → `@next/next/no-img-element` warning |
| Affected checks | `npm run check` (typecheck incl. `tests/db`, lint, unit tests, builds, client-config, db-scripts) | Exit 0; unit tests 38/38; `next build` OK |
| Audit | `npm audit --omit=dev` / `npm audit` | 0 production vulnerabilities; 5 dev-only highs (E06, expected) |

### Acceptance audit (spec criterion → evidence)
| Criterion / scope item | Evidence | Status |
| --- | --- | --- |
| Fresh database migrates and seeds reproducibly | `supabase stop --no-backup` + `db:start` (empty volumes: 0 auth users, 7 migrations + seed applied); then `db:reset`, `test:db` + `db:reset`. Seed-row SHA-256 (7 tables, timestamps excluded) identical on all three: `75bc0e5e…`; schema dumps of consecutive resets byte-identical (2,019 lines) | Met |
| Cross-store/cross-org reads fail under real roles | `rls-reads.test.ts`, plus new `sessions.test.ts`: a store A2 scan is invisible to manager A1, employee A1 and admin B; POG slots are not readable across orgs | Met |
| Revoked membership with a live token | New `sessions.test.ts`: the same signed-in client loses access on its next request after store revocation, org revocation (despite an active store row), and admin → member demotion | Met |
| Expired / forged session at the database | New `sessions.test.ts`: a minted, unexpired local token works (control); expired → `PGRST303`; tampered signature rejected | Met (DB layer; client refresh flows are feature 03) |
| Direct privileged writes fail | `direct-writes.test.ts`; `catalog.test.ts` (authenticated SELECT-only, no client-executable public functions) | Met |
| Invalid coordinates, fractional counts, invalid thresholds, tenant-mismatched FKs fail | `constraints.test.ts` | Met |
| Anonymous access to both private buckets fails | `storage.test.ts` | Met |
| Published rows cannot be edited | `constraints.test.ts`, `concurrency.test.ts` (including concurrent publication) | Met |
| Generated TS types match; no production reset scripts | `db:types:check`; `check:db-scripts` | Met |
| Indexes from data-model.md | New catalog test: every table with `organization_id` has an index leading with it. It failed for `pog_slots`, fixed by migration `…0700_tenant_indexes.sql` | Met |
| Membership helpers, tenant FKs, upload intents, no client-writable role, trusted-only AI/audit/job/confirmation writes | Migrations 01–05; `catalog.test.ts` (no role column on profiles); `direct-writes.test.ts` | Met |
| Publish and scan snapshot functions validate same-organization relationships | `functions.test.ts` (NOT_FOUND across orgs and for revoked users) | Met |

Totals: `npm run check:db` exit 0: 7 migrations, types OK, 8 files, **88/88**.

Unexplained, no longer reproducible: before the instance was recreated, `db:reset` left 69 earlier test users in `auth.users`, and the seed digest was `88af2839…` on two consecutive resets. On the recreated instance, resets clear `auth.users` and the digest is `75bc0e5e…` every time. Recreating destroyed the old state, so the cause was not determined. Earlier "fresh database" evidence came from that old instance; the from-empty run above supersedes it.

### Transactional functions: required now vs. later (decision D29)
| Function | Owner feature | Status |
| --- | --- | --- |
| `publish_pog_version` (validate, freeze, audit) | 02 (used by 05) | Implemented, service-role only, tested |
| `create_scan` (pin version, copy slot snapshots, issue upload intent) | 02 (used by 07/08) | Implemented, service-role only, tested |
| Membership invite/change/revoke with audit | 03 | Deferred. Last-admin trigger and SELECT-only grants already exist |
| Display create/assign, store/product edits with revision checks | 04 | Deferred. Assignment guard and composite FKs already exist |
| Draft slot replacement, clone to new version | 05 | Deferred. Immutability triggers already exist |
| Save counts, confirm (freeze finals, confirmation row) | 06/07 | Deferred. Frozen-after-confirm and append-only triggers already exist; clients cannot write |
| Complete (attestation) | 07 | Deferred. Completed-scan guard already exists |
| Upload finalize and enqueue | 08 | Deferred. `upload_intents` and path constraints already exist |
| Job claim, lease, fenced result, attempt recording | 09 | Deferred. `scan_jobs`/`scan_attempts` already exist, worker-only |
| Corrections, manual takeover, retry | 10 | Deferred. `scan_corrections` already exists, append-only |
| Idempotency record handling | 03+ (first mutating API route) | Deferred. Table and unique key already exist |

## Feature 02 — Explicitly Deferred / Unverified
- **Hosted Supabase:** no hosted project has been migrated or tested (one is named in `.env.local` and was not touched). Mirror `[auth] enable_signup = false` there. Applying the migrations is a deployment step, not part of this feature.
- **Later transactional functions:** see the table above. Each must ship service-role only, with tenant re-checks and negative tests.
- **API-layer authorization:** service-role calls from routes (features 03–05) need their own negative tests.
- **Storage upload validation:** format, dimensions and finalize are feature 08; only bucket privacy and limits are verified.
- **Remaining unindexed FKs:** actor/user FKs (`created_by`, `actor_id`, `confirmed_by`, …) and some composite FKs have no exact covering index. They only affect parent-row deletes, which history rules forbid or keep rare. Revisit with the identity-redaction process (feature 12).
- **RLS performance** at realistic data volumes: not measured.

## Feature 03 — Dependency Check
Feature 02 re-verified at the start of this session before any change: `npm run check:db` 88/88, `npm run check` exit 0 (unit 38/38), Swift fallback 11/11. The local stack was running (Colima); Mailpit at :54324. Xcode still not installed (E01), SwiftPM still broken (E02).

## Feature 03 — What Exists
- **Database** (`supabase/migrations/…0800_membership_management.sql`): `list_organization_members` (admin roster with email, SECURITY DEFINER), `apply_membership_invite`, `update_membership` (full store set, revision check, before/after audit, `membership.revoked` on deactivation), `bootstrap_first_admin` (refuses orgs with an active admin); all service-role only. Last-admin trigger now locks the organization row (defect A02). Regenerated types.
- **Local Auth config** (`supabase/config.toml`): redirect allowlist `http://localhost:3000/auth/confirm`; invite/recovery templates (`supabase/templates/`) with token-hash links; password minimum 12; local email limit 100/h. Signup stays disabled.
- **packages/domain** `auth.ts`: roles, `Me`, `Member`, strict invite/update/reset schemas, password policy, `safeNextPath` redirect allowlist. Health now reports `authentication: not_checked`.
- **packages/server**: `verifyAccessToken` (Supabase Auth `getUser`, D30), `loadMe` (caller-scoped RLS reads), `resolveAdminOrganization`, members service (invite with compensating delete), idempotency over `idempotency_records`, in-process rate limiter, same-origin check, DB error mapping.
- **apps/admin**: `src/proxy.ts` (session refresh), httpOnly SSR cookies (`@supabase/ssr` 0.12.7), `/api/v1/me`, `/api/v1/members`, `/members/invite`, `/members/:user_id`, `/api/v1/auth/password-reset`; form handlers `/auth/sign-in|sign-out|forgot-password|verify|set-password`; pages `/sign-in`, `/forgot-password`, `/auth/confirm`, `/account/password`, `/no-access`; dashboard gated by capability, Members admin-only with invite and edit/revoke UI; store selector lists authorized stores.
- **iOS** (`DisplayRefillKit`): `HTTPTransport`, `SupabaseAuthClient` (D31), `KeychainSessionStore`, `SessionManager` actor, `URLSessionAccountAPI`, `AppLocalDataCleaner`; UI `AppSession`, `SignInView` + reset sheet, `SignedInView` (authorized stores), `AccessRemovedView`. Placeholder sign-in and preview shell removed.
- **Tests**: `tests/db/test/memberships.test.ts` (17); new workspace `tests/api` (43 HTTP tests against `next start` on :3100, Mailpit for email) run by `npm run test:api` (`scripts/run-api-tests.mjs`, loopback only); `packages/domain/test/auth.test.ts`, `packages/server/test/auth.test.ts`; Swift `AuthTests.swift` (stubbed transport), `LiveAuthTests.swift` (opt-in, local stack).
- **Operator bootstrap**: `scripts/bootstrap-admin.mjs`; procedure in operations-runbook.md.
- Docs: decision-log D30–D38, auth-and-permissions and api-contracts implementation sections, operations-runbook (bootstrap, hosted Auth checklist, membership incident), current-issues A02/R09/R10, data-model, READMEs, feature spec status.

## Feature 03 — Verification (2026-10-03, local Supabase on Colima, Node 22.13.1)
| Criterion | Command / evidence | Result |
| --- | --- | --- |
| Invited user signs in and sees only authorized stores | `tests/api/test/members.test.ts` "invites once per Idempotency-Key…": admin POSTs invite → one Mailpit email linking to `http://localhost:3100/auth/confirm?token_hash=…&type=invite` → confirm page → `POST /auth/verify` → set password → password sign-in → `/api/v1/me` lists exactly store A2 (employee). `bearer-auth.test.ts`: per-role store lists for admin A, manager A1, employees A1/A2, admin B. `web-session.test.ts`: manager's store selector shows A Store 1 only. Swift live test: same user via `SupabaseAuthClient` + `/api/v1/me` returns only the assigned store | Met (web + API; iOS client logic on macOS, not on iOS) |
| Expired token refresh works once | Web: `web-session.test.ts` sets cookie `expires_at` in the past → page 200, new access and refresh token in Set-Cookie, API works with it. iOS: `AuthTests` proactive refresh, 5 concurrent calls → 1 refresh, 401 → refresh → retry (exact request sequence me/token/me); Swift live test: expired session refreshes once against local Auth (rotation observed) | Met |
| Invalid refresh returns to sign-in without retry loops | Web: bogus refresh token → 307 `/sign-in?next=%2F`, auth cookies cleared, `/sign-in` 200 (terminal); API with that cookie → 401. iOS: rejected refresh → `.signedOut`, Keychain item deleted, exactly 1 refresh and no retry; second 401 after a successful refresh → stop after 3 requests, later calls make no request; Swift live: bogus refresh token → signed out after 1 attempt | Met |
| Password reset via allowlisted redirects; arbitrary redirects rejected | `password-reset.test.ts`: web form → Mailpit link to `/auth/confirm` → verify → weak/mismatch rejected → new password works, old fails, link single-use; unknown email gets the same answer and no email; cross-origin form rejected; iOS endpoint rejects a `redirect_to` field (422) and answers 202 identically for known/unknown; direct Supabase `/recover` with `redirect_to=https://evil.example/steal` → email contains no `evil.example`; confirm/verify reject `signup`, `magiclink`, `email_change`. `next` allowlist: `web-session.test.ts` (6 hostile values → `/`) and 18 cases in `packages/domain/test/auth.test.ts` | Met (local Mailpit only) |
| Logout clears sensitive cached content | Web: 303 to `/sign-in?signed_out=1`, `Clear-Site-Data: "cache", "storage"`, auth cookies deleted; the old access token → 401 and a copied old cookie → redirect to sign-in (session revoked server-side); cross-origin sign-out rejected. Pages send `no-store`. iOS: Keychain item deleted even offline, logout request carries the bearer, cleaner removes image directories; Swift live: after sign-out the rotated token → our API 401 (Auth log: `/logout 204` then `/user 403`) | Met (iOS cache/image clearing tested on macOS paths) |
| Revoked membership denies next request | `bearer-auth.test.ts`: same token, store revoked → store disappears; org revoked → 403. `members.test.ts`: revoke via API → member's existing token 403. `web-session.test.ts`: existing web session → `/no-access?reason=revoked`, API 403 | Met |
| Employee cannot grant themselves manager/admin (API or DB) | API: employee and manager PATCH self to admin / POST invite / GET roster → 403, rows unchanged. DB: `memberships.test.ts` (function with self as actor → FORBIDDEN; clients cannot execute any membership function: 42501), existing `direct-writes.test.ts` (direct table writes 42501). Editing `user_metadata` to `role: admin` grants nothing | Met |
| Admin-only membership management, audited, last-admin protected | `memberships.test.ts` 17 tests incl. cross-org NOT_FOUND, validation leaves no partial rows, audit before/after; `members.test.ts`: admin B gets 404 on org A, last admin → 409 for demote and revoke, audit `membership.updated` → `membership.revoked`, idempotent replay returns the stored response with no second email, same key + different body → 409 | Met |
| Concurrent last-admin race | Two raw connections demote two admins concurrently: fails with the feature 02 trigger body (both commit), passes with migration 08 | Defect A02 found and fixed |
| CSRF on cookie mutations | `members.test.ts`: cookie PATCH with foreign Origin, no Origin, or `Sec-Fetch-Site: cross-site` → 403 and row unchanged; with app Origin → 200. Sign-in/forgot/sign-out forms reject cross-origin posts | Met |
| Operator first-admin bootstrap | `bootstrap.test.ts`: creates org + admin + invite email; refuses an org with an admin and deletes the identity it created; refuses a non-loopback URL without `--confirm-remote`; argument validation | Met (local only) |
| No alternative identity provider | Only `@supabase/supabase-js` 2.117.2 and `@supabase/ssr` 0.12.7 added; iOS uses Supabase Auth endpoints | Met |
| Public signup disabled | `config.toml` unchanged (`[auth] enable_signup = false`); `direct-writes.test.ts` signup rejection still passes; no sign-up link on `/sign-in` (asserted) | Met (local) |

### Negative controls
| Change made temporarily | Expected failing test | Observed |
| --- | --- | --- |
| Same-origin check disabled in `api-auth.ts` | members CSRF test | Failed as expected; restored |
| `getUser` replaced with local `getClaims` verification | bearer "signed-out session" test | Only that test failed (expired/forged still rejected); restored. Basis for D30 |
| Feature 02 last-admin trigger body reinstated | concurrent demotion test | Failed (both demotions committed); fix reapplied |

### Totals (final run, after `rm -rf apps/admin/.next`)
| Command | Result |
| --- | --- |
| `npm run check` | Exit 0: typecheck 6 workspaces, ESLint 0 problems, unit tests 54/54 (admin 3, domain 20, server 28, worker 3), admin + worker builds, client-config scan OK, db-scripts guard OK (7 manifests) |
| `npm run check:db` | Exit 0: reset (8 migrations + seed), types match, DB 105/105 (9 files), API 43/43 (5 files, fresh `next build` + `next start`) |
| `apps/ios/scripts/swiftc-check.sh` (CLT overlay flags) with `DISPLAY_REFILL_KEYCHAIN_TEST=1` | Core, UI, app entry compile for macOS 14 with `-warnings-as-errors`; 28/28 passed incl. real login-keychain round trip; 3 live tests skipped (env) |
| Swift live suite (`DISPLAY_REFILL_LIVE=1`, server on :3100, local Auth) | 3/3 passed |
| Browser pass (agent-browser, Chromium, :3100) | Sign-in form, overview with authorized stores, Members invite (client fetch passed the CSRF check, email sent) and edit (A Store 2 → manager, audited), sign-out to `/sign-in?signed_out=1`, `document.cookie` empty (httpOnly), employee sign-in → `/no-access?reason=employee`. Screenshots reviewed |
| `npm audit --omit=dev` | 0 vulnerabilities (dev-only E06 unchanged; no `audit fix --force`) |

Process note: one interim Swift live run failed because the `.next` build on disk was still the `getClaims` negative-control build (Supabase Auth log showed a JWKS fetch and no `/user` call). After rebuilding, the same test passed. All totals above come from fresh builds.

## Feature 03 — Unverified / Remaining
- **iOS on iOS**: no Xcode, so no iOS SDK build, simulator or device run. Keychain behaviour was exercised only in the macOS login keychain; `kSecUseDataProtectionKeychain`, background refresh after first unlock, app relaunch restore and the SwiftUI screens on a phone are unverified. supabase-swift not used (D31).
- **Email delivery**: only local Mailpit. No hosted SMTP, no real inbox, no phone mail client opening the links, no link-scanner behaviour observed.
- **Hosted project**: no migration applied, no Auth setting changed (Site URL, allowlist, templates, password length, signup) — see the runbook checklist. `workers/scan-worker/.env` still names a hosted URL; nothing in this feature used it.
- **Rate limits** are per process (R09) and were only tested for password reset; sign-in, invite and set-password limits are not exercised by tests.
- **Supabase Auth redirect behaviour**: any path/port on the site_url host is accepted (observed with :3100); other hosts fall back to site_url. Re-check on the hosted version.
- **Session revocation in Auth on membership revoke**: revocation is enforced by membership checks on every request; Auth sessions are not ended. Ending them needs the dashboard (runbook).
- Dark theme of the new pages not reviewed; accessibility (screen reader, keyboard-only) of the Members editor not tested.
- Idempotency records are not yet cleaned up after expiry beyond reuse of the same key (feature 12 retention).

## Feature 04 — Dependency Check
Feature 03 re-verified before any change (2026-10-03, local Supabase on Colima): `npm run check:db` exit 0 — DB 105/105, API 43/43; `npm run check` exit 0 — unit 54/54, lint 0 problems, builds OK. Xcode still not installed (E01), SwiftPM still broken (E02). Feature 03's auth, membership authorization and audit code paths were not modified, except two additive changes: `ApiContext` now carries the verified access token (for RLS-scoped reads) and `resolveAdminOrganization` takes an optional refusal message.

## Feature 04 — What Exists
- **Database** (`supabase/migrations/…0900_catalog_management.sql`, no table changes): service-role-only `create_store`, `update_store`, `create_product`, `update_product`, `create_pog` (identity + empty draft v1), `update_pog`, `create_display`, `update_display`. Each derives organization/store from the stored row (`FOR UPDATE`/`FOR SHARE`), re-checks the actor (`is_org_admin` / `is_store_manager`), checks `expected_revision`, skips no-op changes, writes audit events in the same transaction, and names the bad field in HINT. Assignment accepts only a published version of a non-archived POG in the display's organization. Private helpers explicitly revoked from PUBLIC. Types regenerated.
- **packages/domain** `catalog.ts`: strict request schemas, response shapes (`Store`, `Product`, `Pog`, `Display`, `DisplayDetail`), `ListQuery`, `page`/`organizationPage`.
- **packages/server** `catalog.ts`: RLS-scoped list/detail reads with cursor pagination and status filters, write wrappers over the functions, `storeAccess`; `fromDbError` maps HINT to `field_errors`; `resolveMemberOrganization`.
- **apps/admin API**: `GET|POST /stores`, `PATCH /stores/:id`, `GET|POST /stores/:id/displays`, `GET|PATCH /displays/:id`, `GET|POST /products`, `PATCH /products/:id`, `GET|POST /pogs`, `PATCH /pogs/:id` via `server/api-handlers.ts` (auth + CSRF, strict body, early capability check, Idempotency-Key, replay).
- **apps/admin UI**: Stores, Products, POGs (identity create/rename/archive; an on-page note says drawing/publishing is feature 05), Displays (per store: create, rename, assign/unassign published version, archive/restore, last scan, archived-product warning). Status filters, empty states naming the next authorized action, permission notes, per-field validation errors, conflict notice with "Reload latest", session-expired and network messages that keep input, `loading.tsx`, `error.tsx` with retry, working store filter in the navigation, row-specific accessible button names.
- **Tests**: `tests/db/test/catalog-management.test.ts` (15), `tests/api/test/catalog.test.ts` (16), `packages/domain/test/catalog.test.ts` (6), `packages/server/test/catalog.test.ts` (6). Writes use per-run organizations (D45); published versions are synthetic fixtures inserted with SQL until feature 05.
- Docs: decision-log D39–D45, api-contracts (implemented routes), data-model and auth-and-permissions (feature 04 sections), current-issues A03/R05, READMEs, feature spec status.

## Feature 04 — Verification (2026-10-03, local Supabase on Colima, Node 22.13.1)
| Criterion | Command / evidence | Result |
| --- | --- | --- |
| Admin configures two stores and sample products | API: admin POSTs two stores and three products (SKU/UPC/PLU variants); lists return them, never org B's; audit shows 2× `store.created`, 3× `product.created`. Browser: admin adds a store; a duplicate number (`a-001` vs `A-001`) shows the field error with input kept, then succeeds | Met |
| Manager only mutates assigned displays | API: manager creates/renames/unassigns/archives in their store; for another store in the same org: list, create, read and patch all 404, rows unchanged; employee create/patch 403; admin acts org-wide. DB: same via functions, plus manager `update_store` → FORBIDDEN. Browser: manager sees one store in the filter and only their org's published versions; a URL for another store shows "Store not found"; Stores/Products read-only with a permission note | Met |
| Cross-organization POG assignment rejected server-side | API: assigning org A's or B's published version, a draft, or an unknown ID to an org C display → 422 `field_errors.active_pog_version_id` (same message); org B manager assigning C's version → 422, no row. DB: same plus an archived POG's version | Met |
| Empty states give the next authorized action; unauthorized actions blocked by the API | API (HTML): new org admin sees "No stores yet" + "Add a store", "No products yet", Displays → "Create a store on the Stores page first"; manager of an empty store sees "No displays in Fresh yet" + "Add a display" and no "Add a store". Manager/employee POST/PATCH on stores/products/POGs → 403; other-org admin → 404 for every record type, rows unchanged | Met |
| Archiving a display prevents new scans and preserves prior scan detail | API + DB: scan created, display archived, `create_scan` → VALIDATION_FAILED; earlier scan and its slot rows unchanged and still readable by the employee (RLS); archived display still has detail and is listed under `status=archived` for managers (employee 403). Store archive also blocks scans and new displays. Concurrency: an archive waits for an in-flight `create_scan` (row lock) and the next scan is refused | Met |
| Product rename does not alter existing scan snapshots | API and DB: scan on a synthetic published version; product renamed via PATCH / `update_product` → `scan_slots.product_name_snapshot` keeps the old name; archiving it raises `has_archived_products` on the display | Met |
| Concurrent edits return a revision conflict | DB: two raw connections, same `expected_revision` → second gets CONFLICT, first value kept. API: two parallel PATCHes → one 200, one 409; stale store/product PATCHes → 409. Browser: out-of-band change while the form is open → conflict notice; after "Reload latest" a second save changed only the edited field (defect A03 found and fixed) | Met |
| Idempotency, CSRF, input limits | Replay returns the stored 201 with `idempotent-replayed`; same key with a different body → 409; missing key → 422. Cookie POST with a foreign Origin or no Origin → 403; app Origin → 201. Smuggled `active`/`actor_id`/`organization_id` fields → 422. Forged cursor, limit 101, unknown status → 422 | Met |

### Negative controls (local DB, restored by `db:reset`)
| Temporary change | Expected failing test | Observed |
| --- | --- | --- |
| `update_display` revision check disabled | DB concurrent-edit test; API "concurrent edits" | Both failed (API saw `[200, 200]`, a silent overwrite) |
| Organization filter removed from `check_assignable_version` | DB and API cross-org assignment tests | Both failed; the composite FK still rejected the write (23503 → API 500), so the explicit check is what produces the 422 |

### Defects found during verification
- **A03** (UI): forms sent all fields, so after a conflict + reload a stale untouched field could revert another user's change. Fixed with edit tracking (D43); re-verified in the browser.
- **Test isolation**: the first full run failed 4 existing feature 02/03 tests (`rls-reads`, `sessions`) because the new suites wrote into seed org A, whose exact contents those tests assert. Each new suite now uses its own per-run organization (D45). A second DB + API pass without a reset is green.
- A flaky ordering assumption in a new DB test (two audit events in one transaction share `created_at`) was fixed in the test query.

### Totals (final run, after `rm -rf apps/admin/.next`)
| Command | Result |
| --- | --- |
| `npm run check:db` | Exit 0: reset (9 migrations + seed), types match, DB 120/120 (10 files), API 59/59 (6 files, fresh `next build` + `next start`) |
| `npm run test:db`, then `npm run test:api -- --no-build` (rerun, no reset) | Exit 0: 120/120 and 59/59 |
| `npm run check` | Exit 0: typecheck all workspaces, ESLint 0 problems, unit 66/66 (admin 3, domain 26, server 34, worker 3), admin + worker builds, client-config scan OK, db-scripts guard OK |
| Browser pass (agent-browser, Chromium, production build on :3200, synthetic local users) | Admin: create store, duplicate-number validation, success state, conflict → reload → re-save. Manager: displays page, add display with version, archive via confirm dialog, archived filter, other store's URL denied, read-only stores/products, keyboard toggle of edit forms, 390 px layout. Screenshots reviewed |

## Feature 04 — Unverified / Remaining
These are the Feature 04 handoff notes; the reference/publication gaps are closed by Feature 05 below.
- **iOS build/device: still unverified** (E01/E02, unchanged). No iOS code changed; the iOS app does not call the feature 04 routes yet (feature 07).
- **Published versions come from synthetic SQL fixtures**; the real POG builder/publication path is feature 05. `GET /pogs/:id/versions/:version_id` is not implemented.
- **Hosted project**: migration 9 not applied anywhere but local; nothing hosted was touched.
- Screen reader (VoiceOver/NVDA) and dark theme not tested; contrast not measured. Keyboard and accessible names checked in the browser only.
- Lists are oldest-first per the cursor contract; no name sort or search. Pages show up to 50 rows per page with "Show more".
- Archived stores do not appear in the navigation store filter (it lists active stores); their displays are reachable from the Stores page link.
- Rate limiting for catalog mutations is not added (none specified); idempotency records are still not cleaned up after expiry (feature 12).
- The agent-browser synthetic click on the row "Edit" button did not register in two attempts while DOM `.click()` and keyboard Enter did; not reproduced as an app defect, cause unknown.

## Next Up
Feature 07: iOS manual workflow (Feature 06 backend evidence below). Install Xcode to close the iOS build gap for features 01 and 03.

## Open Questions
See decision-log.md for provider, hosting, device minimum, retention, training eligibility and real POG data. No question blocks the next local feature.

## Session Notes
Documentation checks are not application tests. Do not copy the reference project's completion claims, package versions, screenshots or authentication state into this project. This project directory is not its own git repository: the enclosing repository root is the user's home directory, so no commits were made. (Feature 04 session: `git rev-parse --show-toplevel` reports the project directory itself; no commits were made in this session either.)

## Feature 05 — What Exists (2026-10-03, local only)
- Completed the pre-existing unverified builder files after reading the required context and installed Next 16 route/client documentation. Earlier auth/catalog/UI changes and field-specific Feature 04 PATCH forms were retained; no iOS code, SIMON.md, hosted Supabase or git commits were changed by this feature session.
- **Migration 10** (`supabase/migrations/20261003001000_pog_builder.sql`): canonical reference validation/review/source fields; service-role-only draft cloning, slot-set saves, upload intents/finalization/settlement; admin/tenant/revision checks and transactional audits; validated-reference and coordinate-review publication guards. Existing published-version/slot locks, product locks and scan snapshots remain in force. Database types regenerated from local Supabase.
- **Domain** (`packages/domain/src/pog.ts`, `pog-geometry.ts`): strict requests/responses, six-decimal canonical rectangles, integer precision checks, touching-vs-overlap validation, pointer content-box mapping, keyboard movement/resizing and draft/publication blockers.
- **Server/API** (`packages/server/src/pogs.ts`, `pog-images.ts`, `/api/v1/pogs/:id/versions`, `/pog-versions/:id/*`): actor-bound ten-minute authenticated raw-byte upload, 10 MiB streaming limit, private write-once Storage, decoded JPEG validation/dimension limits, EXIF orientation plus rotation/crop, metadata-free max-2048 JPEG, content-addressed immutable outputs, draft revisions/idempotent JSON retries, actual-object existence check before atomic publication, five-minute RLS-authorized reference links. No employee scan-photo workflow was implemented.
- **Web** (`apps/admin/src/components/pog-editor/`, version page and POG list): photo/bounds editor, drawing/select/move/eight-handle resize/delete, keyboard and percentage inputs, product/label/target/inclusive trigger/order, explicit save/conflict/validation states, saved-only publication, required coordinate review after replacement, immutable viewer and clone action. Publication/assignment are separate.
- **Tests**: domain geometry/contracts, server image decoding/orientation/crop/metadata tests; `tests/api/test/pog-builder.test.ts` has 11 local integration tests using **actual upload → finalize → save → publish routes**, including cloning/assignment and trusted scan creation. Older DB fixtures mark synthetic references validated so pre-existing publication regression tests continue testing their original invariants; new Feature 05 tests do not insert published fixtures.

## Feature 05 — Verification Evidence
| Check | Command / evidence | Observed result |
| --- | --- | --- |
| From-empty local migrations, generated types, earlier database tests | `npm run check:db` (local Supabase/Colima, fresh reset) | Exit 0: 10 migrations + seed, generated types match, **120/120 DB tests**, including publication-vs-slot/product races, last-admin concurrency, RLS/storage denials, history and audits |
| HTTP regression + real builder integration | Same `check:db` runs fresh production build/server on :3100, `tests/api` | **70/70** across 7 files (59 existing + 11 builder). Upload/finalize/save/publish/idempotent replay; clone/change/publish/manager assign; original scan version/name/label/target/threshold snapshots and historical image survive; immutable published API/table writes denied |
| Invalid publication | `pog-builder.test.ts` | Missing/unvalidated reference, missing actual Storage object, empty layout, overlap and inactive product refused with draft/audit unchanged. Out-of-bounds, zero/fractional target, invalid trigger, duplicate labels and cross-org products refused on save and cannot publish |
| Authorization at each boundary | Same integration file, actual admin/manager/employee/other-org identities | API authoring denied 403/404; draft image denied; RLS hides draft; direct authenticated RPC and guessed Storage read denied; manager published read allowed, employee unassigned read denied; historical pinned image allowed; CSRF refused; live-token revocation blocks an issued upload grant; another same-org admin cannot use someone else’s grant |
| Concurrent operations + retries | Same integration file | One save/publication winner + 409 loser; one clone + 409 loser; one simultaneous publication + 409 loser; shared-key save replay adds only one revision/audit; publication/finalization replay unchanged; changed body/key conflict; competing crops return one 200 and one 409, winning image bytes/dimensions/hash remain unchanged after publish and a late finalize |
| Unit checks | `npm test` | **95/95**: admin 3, domain 48, server 41, worker 3. Includes EXIF orientation + quarter turn before crop, metadata removal, malformed/oversized/tiny image rejection, no letterbox drift, touching edges and keyboard geometry |
| TypeScript, lint and worker | `npm run typecheck`, `npm run lint`, `npm run build:worker` | Exit 0 (all six workspace typechecks; ESLint no warnings/errors; worker bundle built). Admin production build passed in `check:db` |
| Secret/script guards | `npm run check:client-config`, `npm run check:db-scripts` | Exit 0; only publishable client configuration, no remote/non-local reset commands |
| Actual browser editing and publication | Playwright skill, visible Chromium, temporary local production server :3205; synthetic per-run org/admin; `/tmp/playwright-test-pog.js` | Passed upload, left/right rotation, canonical 80% width crop, draw/move/handle resize, metadata/numeric values, arrow/Shift/Alt keyboard edit, keyboard add/Delete, invalid numeric save denial, out-of-band edit → 409 → reload → re-save, publish, Displays form assignment and clone. No page errors. Screenshot reviewed (`/tmp/pog-editor-desktop.png`) |
| Coordinate placement at viewport/zoom changes | Same browser pass: actual image/slot DOM rectangles measured at **1440×1000, 768×1024, 390×844**, CSS zoom **125%** | x/y/w/h match configured 0.1/0.1/0.3/0.3 within 0.0002 normalized units; image-content aspect matches canonical crop. Domain tests additionally cover deliberately letterboxed content boxes. No camera-perspective claim |

Verification corrections: the initial new API tests attempted to expire an intent before its creation timestamp (existing constraint correctly rejected the fixture) and expected 401 on a cookie mutation without an Origin (existing CSRF correctly returned 403). Fixtures/headers were corrected; final from-empty run above passed. A sandboxed build cached a Turbopack port-binding failure; moving the failed `.next` cache to `/tmp` and rebuilding with loopback process permission resolved it. Early browser scripts needed hydration waiting, exact group selectors, upload-success heading assertion and canvas centering below the sticky toolbar; the final workflow passed.

## Feature 05 — Explicitly Unresolved / Scope Boundaries
- **iOS SDK build, simulator and physical device remain unverified** (E01/E02). No iOS Feature 05 client was built or tested.
- Keyboard controls were exercised in Chromium, but a full keyboard-only journey, screen readers (VoiceOver/NVDA), measured contrast, touch gestures and dark mode were **not** tested. Safari/Firefox were not tested.
- Browser zoom evidence is CSS zoom at 125%; native browser zoom controls were not separately exercised. Geometry uses current content bounds rather than cached viewport dimensions.
- Reference-object cleanup after failed concurrent finalization/replacement, expired unused intents and idempotency retention remain Feature 12. No cleanup can delete a source image still shared by cloned/published/pinned versions. Immediate cleanup only covers finalized/rejected/expired staging objects reached by finalization; cleanup failures are logged for later recovery.
- New POG API upload endpoints enforce ten-minute grants instead of Supabase’s fixed two-hour signed upload tokens. Published-reference existence checks use private Storage reads before the transactional DB publication; Storage and PostgreSQL are separate systems, and privileged out-of-band deletion remains an operator/retention responsibility.
- Signed reference reads may remain usable for up to five minutes after access revocation, as specified. Uploaded reference images were synthetic local JPEGs; no real store photos/provider calls or hosted operations.
- Scans were created with the existing trusted `create_scan` function to prove historical preservation. Employee manual/photo capture/count/vision workflows remain Features 06–10; Feature 08 still owns scan-photo upload validation.

## Feature 06 — What Exists (2026-10-03, local only)
- Read the required context, inspected Feature 05 implementation/evidence, and read the installed Next 16 route guide before editing. Initial working tree was clean. Earlier auth/catalog/POG code and checks were retained; no SIMON.md, iOS code, real uploaded POG photographs, hosted Supabase or git commits were touched.
- `packages/domain/src/refill.ts`: one validated pure calculator for slot recommendations, product aggregates and rounded/capped fill score. Includes positive targets, inclusive optional triggers, known overstock, unknown propagation and strict count/confirmation request schemas. Products aggregate **after** per-slot calculation, so excess cannot offset a shortage.
- Migration 11 (`supabase/migrations/20261003001100_refill_engine.sql`): `mutate_scan_counts` is service-role-only, rechecks employee ownership/manager store/admin organization access, locks the scan and slots, checks revision/state, and saves accepted counts/verification plus append-only provenance. Confirmation recomputes from pinned snapshots, stores immutable slot finals, total/score, one confirmation and audit. The committed response snapshot and SHA-256 body hash are stored in the same transaction for safe retries; authorization is checked before replay. Also closes null-confirmation-timestamp and child-write history-guard gaps. Database types regenerated from the local applied schema.
- `packages/server/src/scans.ts`, `apps/admin/src/server/scan-handlers.ts` and `/api/v1/scans/[scan_id]`, `/counts`, `/confirm`: caller-scoped single-statement detail reads; strict authenticated count/confirmation endpoints with cookie CSRF checks, revision and idempotency requirements. Both clients receive the same server calculations, explicit provisional state, unresolved IDs and product groups. Final responses read stored quantities. Slot ordering and UTC timestamps are deterministic.
- `packages/domain/test/refill.test.ts`: supplied JSON cases, aggregation and invalid fragments; unknown product/display totals; inclusive equality, overstock capping, half-up score rounding and strict authority-injection denials. Refill bounds checked across every allowed count 0–999 for representative targets/triggers.
- `tests/api/test/refill.test.ts`: nine synthetic local integration scenarios covering counts/confirmation and their actual PostgreSQL transaction. Fixture creation uses the existing trusted `create_scan`; POG fixtures are synthetic, and history preservation includes clone → change target/threshold → publish → assign after confirmation.

## Feature 06 — Verification Evidence
| Check | Command / evidence | Observed result |
| --- | --- | --- |
| From-empty migration/security regression | `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock npm run check:db` | Exit 0: **11 migrations + synthetic seed**, generated types match, **120/120 DB tests**, fresh Next production build, **79/79 API tests** (70 earlier regressions + 9 refill scenarios) |
| Full workspace checks | `npm run check` | Exit 0: all six workspace typechecks, ESLint no warnings/errors, **110/110 unit tests** (admin 3, domain 63, server 41, worker 3), admin/worker builds, client-config and local-db-script guards |
| Unknown and verification | New refill API suite | Initial nulls block confirmation with slot IDs; partial saves preserve unknown slots; known required-review counts remain provisional until explicitly verified. Unchanged verification records a correction; original synthetic AI evidence stays unchanged. Known non-required slots may confirm while pending |
| Validation / rollback | Domain + actual API/RPC tests | Negative/fractional/oversized/string/null human counts, bad revisions, duplicate/non-pinned slots and target/total injection rejected. A direct RPC batch with a valid first item and invalid second rolls back counts, corrections and revision |
| Authorization / CSRF | Actual employee, peer employee, unassigned same-org member, manager, admin and other-org identities | Peer employee mutations 403; unassigned/cross-org mutations 404; manager count save/admin confirmation allowed; direct authenticated RPC/table mutation 42501. Foreign-origin cookie save 403; same-origin allowed. Revocation denies even a previously successful key replay |
| Concurrency / retry | Parallel HTTP requests against local PostgreSQL | Distinct keys confirming one revision → one 200 and one 409, one confirmation/audit. Same-key concurrent saves/confirmations → same committed snapshot, one mutation/revision; lost-response style replay unchanged; changed body/key → 409; competing count edits → one 200/one 409 |
| Arithmetic / frozen history | Domain-versus-SQL parity plus clone/publication/assignment test | Slot/product finals and scores agree at threshold boundaries, zero and overstock. Product rename and assignment of new POG targets/triggers do not change confirmed detail. Post-confirm count edits, slot insert/update and clearing `confirmed_at` refused |

Verification corrections: the first new HTTP run exposed a missing service-role execute grant on the private payload helper (500; all failed transactions rolled back). Added the narrow grant while retaining client revocation, then repeated the from-empty check successfully. Corrected a synthetic overstock test's score expectation from 38 to **31** (`round(100 × (3+0+1)/13)`). Final response refinements normalize timestamps/order and reject revisions beyond PostgreSQL integer range; final production HTTP recheck is recorded below.

## Feature 06 — Limitations / Handoff
- **iOS simulator/SDK build and physical device remain unverified** (E01/E02/E03 unchanged). No new iOS or web count-entry UI was implemented or browser/device acceptance claimed. Feature 07 must display these server results and show unsaved edits as “Save to recalculate.”
- Feature 07 owns creation HTTP orchestration, completion/attestation and the manual client. Feature 08 owns photo upload. Features 09/10 own worker evidence ingestion, confidence routing, takeover and AI correction UI. This feature implements only the backend count/verification/provenance needed by those consumers.
- Only synthetic local fixtures were used. AI verification tests install synthetic observations during a simulated processing state; no provider/model calls, real photo inference, automatic import or training occurred. No hosted migration was applied.
- SQL confirmation mirrors the pure TypeScript formula to recompute under the transaction lock (D52); future rule changes must preserve parity tests. Already confirmed responses use frozen stored quantities.
- Retry evidence exercises ignored-response/replay and concurrent same-key requests; no forced operating-system/server-process crash was injected. The response snapshot is in the same PostgreSQL commit as the result, eliminating the separate response-record write window.
- Idempotency expiry/cleanup remains Feature 12. This transaction expires matching records on use; no background cleanup was added. The full pilot/client/provider workflow is not complete.

Final post-refinement rechecks: `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock npm run test:api` rebuilt the production admin with the final source and passed **79/79** across 8 files (exit 0); `npm run test -w @display-refill/domain` passed **63/63** across 5 files (exit 0). `git diff --check` passed. No commits were created.

## Feature 07 — Implementation and Evidence (2026-10-03)
- Existing Supabase Auth/Keychain/session manager remain the authentication authority. Authenticated transport now supports Codable manual requests and pagination while keeping one refresh/one retry on 401, exact mutation bytes and idempotency keys.
- SwiftUI assigned stores → active displays → manual creation → unknown numeric counts → save/review → immutable confirmation → employee completion attestation → reopen saved scan detail. Native numeric fields and named Increase/Decrease controls; blank is not zero and controls require an explicit count. Rows show pinned product/slot/target/trigger and saved/unsaved verification state.
- Refill quantities, product groups, slot quantities, unresolved counts and revisions come from Feature 06 responses. No Swift authoritative refill formula, camera/photo upload, vision call or full searchable history was added.
- Transient errors retain in-memory input and exact pending request/key; duplicate actions are disabled. Conflict reload retains entries and requires explicit review/save at the latest revision. Loading, empty assignment/display lists, missing POG, permissions, expired session and retry messages are present. Confirm is blocked with missing/invalid/unsaved/unverified counts.
- Migration `20261003001200_manual_workflow.sql` adds a narrowly granted transactional wrapper around existing `create_scan` plus completion, storing idempotency snapshots atomically and re-checking access before replay. Completion writes time/actor/revision/audit only, leaving slot observations and frozen refill quantities unchanged. Generated database types were regenerated, not hand-edited.
- Device-saved account-scoped scan-ID links use UserDefaults. Reopening fetches server detail anew; no offline count synchronization or durable unsaved-input promise.
- Files: `ManualWorkflow.swift`, `ManualCheckView.swift`, authenticated transport/app composition/signed-in navigation; creation/completion route handlers and server wrapper; migration/types; seven mocked Swift tests, one opt-in live Swift workflow, expanded local HTTP workflow test and `scripts/run-ios-manual-tests.mjs`. The fallback script now accepts an empty flags array on macOS's older Bash.

| Check | Actual result |
| --- | --- |
| `npm run check` | Exit 0: all workspace typechecks, lint, 110 TS unit tests, Next production build, worker bundle, client-config and local DB-script checks |
| `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock npm run check:db` | Exit 0: clean local reset applied all 12 migrations and synthetic seed; generated types match; DB 120/120, HTTP API 80/80 |
| `OUT_DIR=/tmp/feature07-swift SWIFTC_FLAGS="…overlay… -Xfrontend -disable-cross-import-overlays" apps/ios/scripts/swiftc-check.sh` | Exit 0: Core, SwiftUI and app entry point compiled for macOS with warnings-as-errors; Swift suite passes, including seven new mocked tests. Live Auth/Keychain/manual suites opt-in and skipped by default |
| `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock node scripts/run-ios-manual-tests.mjs /tmp/feature07-swift/CoreTests --no-build` | Exit 0: actual Swift client signs into local Supabase as isolated synthetic employee, selects assigned store/display, creates unknown manual slots, blocks blank confirmation, saves explicit zero, consumes server recommendations, confirms, completes, then reopens persisted detail using fresh client/session-manager/model. Counts and refill quantities unchanged by completion. Vision absent; synthetic access revoked afterward |
| Local API workflow assertions | Same-key concurrent creation/completion replay, changed bodies (including another display) conflict, stale edits fail, no POG and changed POG handled, peer/cross-org/revoked-store writes denied, cookie CSRF denied, exactly one completion audit, frozen slots preserved and detail re-fetch matches |
| Swift mocked assertions | Blank vs zero, strict integer limits, deliberately non-derived server quantity displayed, exact byte/key retry after connectivity failure, explicit conflict reload preserves input and uses new revision/key, immutable scan cannot save, fresh-model reopen, denied input retained, 401 mutation refresh preserves bytes/key |
| `xcode-select -p`, `xcodebuild -version`, `xcrun simctl list devices` | Only /Library/Developer/CommandLineTools; Xcode required / simctl unavailable. No Xcode.app in /Applications |
| `/usr/bin/swift test --package-path apps/ios/DisplayRefillKit` | Fails linking PackageDescription manifest (existing E02). Plain swiftc with temporary VFS overlay works; system files were not edited |
| Accessibility source inspection | Semantic native colors/fonts, text status labels, numeric VoiceOver labels, per-slot named controls and ≥44-point count/control frames. Runtime VoiceOver, large Dynamic Type, keyboard/focus and physical-device usability remain unverified |

**Acceptance still open:** actual iOS app build, simulator/device manual UI flow, app termination/relaunch with Keychain + saved-ID navigation, VoiceOver and Dynamic Type. A fresh macOS client/model reopening a persisted scan is independent evidence of API/session wiring, not proof of actual iOS app relaunch. Hosted Auth/email, paid provider and device/network-background behavior remain untested. No hosted Supabase operations, SIMON.md edits or commits were performed.

Next smallest unit: install/select Xcode, generate the existing iOS project, build/test its actual target and exercise Feature 07 (including stale edits, network loss, restart and accessibility). Feature 07 is not marked acceptance-complete.
