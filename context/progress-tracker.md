# Progress Tracker

## Current Phase
Phase 3 — Photo analysis. Features 04–06 are verified locally. Feature 07 runs as an actual iOS app; spoken VoiceOver/focus order and physical-device use remain unverified. Feature 08 (photo capture/storage) was found implemented but unrecorded at the start of the Feature 09 session; its backend tests pass, and its simulator import flow now passes after an import crash was fixed (A05). Physical camera capture is unverified. Feature 09 (durable analysis) is implemented locally with the deterministic mock adapter only; no real vision provider is selected. Feature 10 (estimate review/corrections) is implemented and verified locally against that mock output; spoken VoiceOver and physical-device checks remain open. Feature 11 (history and manager review) is implemented locally on iOS (simulator) and web; spoken VoiceOver and physical-device checks remain open. Nothing has been applied to hosted Supabase.

## Current Goal
Close the open device and assistive-technology checks for Features 07–10 (lists under Features 09 and 10 below). Then run a small provider benchmark and data-handling review before any real vision provider is configured. Feature 12 (operations/retention) is the next implementation unit; it has not been started.

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
- Feature 09 durable analysis queue/worker with the deterministic mock adapter, locally (evidence and open device/provider items below).
- Feature 10 estimate review, append-only corrections and iOS takeover, locally against mock output (evidence and open items below).
- Feature 11 scan history and manager review on iOS and web, locally (evidence and open items below).

## In Progress
Open acceptance items carried forward (not blocking independent work): Feature 07 spoken VoiceOver/focus order; Features 07–10 physical-device use; Feature 10 spoken VoiceOver for the review screen; Feature 11 spoken VoiceOver for History and records; Feature 08 real camera capture/permission/background recovery on a device; Feature 09 real-provider benchmark and data-handling review.

## Feature Status
| Feature | Status | Evidence |
| --- | --- | --- |
| 01 Foundation | Implemented; actual iOS simulator target builds | Earlier TS/macOS evidence below; fresh full-Xcode app build and iOS Core tests recorded under Feature 07 |
| 02 Database and security | Complete (local) | 88/88 DB tests on a from-empty instance, acceptance audit, lint fixed (below) |
| 03 Supabase Auth | Implemented; verified locally on web and iOS simulator | Earlier regressions below; Feature 07 now proves real iOS sign-in, Keychain restoration across process restart and persistent logout |
| 04 Store/display/product management | Implemented; verified locally (no iOS client yet) | DB 120/120, API 59/59, unit 66/66, browser pass, 2 negative controls (below) |
| 05 POG builder | Complete locally; accessibility/device gaps explicit | Migration 10, DB 120/120 regressions, API 70/70 (11 new real-workflow tests), unit 95/95, Chromium workflow/viewport checks (below) |
| 06 Refill engine | Complete locally (backend only) | Migration 11; unit 110/110, DB 120/120, API 79/79; authorization, concurrency, retry and frozen-history evidence below |
| 07 Manual iOS workflow | Implemented; acceptance incomplete | Actual signed iOS app: both default/largest-size simulator workflows and native accessibility audits pass, including keyboard, retry/conflict, restart/reopen/logout. Spoken VoiceOver remains required and unverified; physical device separately unverified. Fresh results below |
| 08 Photo capture/storage | Implemented; acceptance incomplete | Migration 13, photo API 6/6, simulator import → crop → upload → finalize passes after crash fix A05. Real camera, permission-denied on device and device background recovery unverified |
| 09 Vision pipeline | Implemented locally (mock adapter only) | Migration 14; DB 141/141 (21 new), API 89/89 (3 new), units 128/128, Swift 46 reported/41 run, simulator photo-analysis UI test passes; fencing negative control. Real provider not selected; device unverified |
| 10 Review/corrections | Implemented locally (mock vision output); acceptance incomplete for VoiceOver/device | Migration 15; DB 141/141, API 92/92 (3 new), units 129/129, Swift 54 reported (8 new), negative control, Feature 10 simulator workflow passes. Full simulator suite: 60 test cases = Core 56 (51 passed, 5 opt-in skipped) + UI 4 (4 passed); 55 passed, 0 failed (after a harness isolation fix; totals reconciled from the xcresult bundle in the Feature 11 session). Spoken VoiceOver, physical device and real-provider output unverified |
| 11 History/admin review | Implemented locally; acceptance incomplete for VoiceOver/device | No migration. API 97/97 (5 new), units 132/132 (3 new), Swift host 62 reported (8 new), negative control, browser keyboard pass; full simulator suite 69 cases: 64 passed (Core 59 + UI 5), 0 failed, 5 opt-in skipped. Spoken VoiceOver and physical device unverified; retention job itself is Feature 12 |
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
Feature 11 (history/manager review), after recording the Feature 10 results below. (Earlier entry, now superseded: Feature 07 and the Xcode install are done; see their sections.)

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

## Feature 07 — iOS Verification Recheck (2026-10-03, macOS 26.6.2 / 25G83)

**Not acceptance-complete. Feature 08 was not started.** Read the tracker, current issues and Feature 07 spec; inspected XcodeGen project.yml, Package.swift, iOS app entry point/configuration and installed tools. Initial tree was clean. No application/API/DB behavior was changed. An exploratory Package.swift language-mode change was reverted; the manifest is unchanged.

| Probe / command | Observed result |
| --- | --- |
| `xcode-select -p`; `xcodebuild -version`; `xcrun --find xcodebuild` | CLT selected at `/Library/Developer/CommandLineTools`; full Xcode required/not found |
| Spotlight bundle-ID lookup and filesystem searches of Applications, user Applications/Downloads, Volumes, /opt and /Library/Developer | No full Xcode.app, xcodebuild binary, iPhoneSimulator.sdk or Xcode archive found. `/Applications/Developer.app` is Apple Developer (`developer.apple.wwdc-Release`), not Xcode. No DEVELOPER_DIR/SDKROOT/TOOLCHAINS override was set |
| `xcrun --sdk iphonesimulator --show-sdk-path`; `xcrun --sdk iphoneos --show-sdk-path` | Both SDKs cannot be located; only macOS SDKs are in CLT |
| Standalone `/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl list runtimes -j` / `list devices available` | **iOS 26.5, build 23F77**, available. iPhone 17 Pro UUID **C5F3DEA0-0C84-4ED2-84D8-60D0933463CC** available (initially Shutdown). Corrects the earlier inference that missing xcrun simctl meant no runtime |
| Standalone simctl `boot <UUID>` then `bootstatus <UUID> -b` | Exit 0; initial data migration and system-app startup finished after approximately 73 s. Device became Booted. Returned it to Shutdown afterward; no app installed/launched and no device erased |
| From apps/ios: `xcodebuild -scheme DisplayRefill -destination 'platform=iOS Simulator,id=C5F3DEA0-0C84-4ED2-84D8-60D0933463CC' build test` | Exit 1 before project compilation: xcodebuild requires full Xcode; active developer directory is CLT. Generated project and actual iOS app target remain unverified |
| `/usr/bin/swift --version`; default `swift test --package-path apps/ios/DisplayRefillKit` | Swift 6.2.3; reproduced existing PackageDescription manifest link failure |
| Inspect public/private PackageDescription interfaces and `nm -gU libPackageDescription.dylib` through CLT swift-demangle | Private interfaces date 2024 and identify Swift 5.10; public interfaces/dylib identify Swift 6.2.3. Old SwiftVersion initializer referenced by compilation differs from dylib SwiftLanguageMode ABI |
| `swift package … --manifest-cache none -Xbuild-tools-swiftc -vfsoverlay -Xbuild-tools-swiftc /tmp/feature07-clt-overlay.json -Xbuild-tools-swiftc -module-cache-path -Xbuild-tools-swiftc /tmp/feature07-manifest-module-cache dump-package` | Exit 0 with unchanged manifest after replacing private-interface reads through temporary VFS overlay **and** using fresh cache. Confirmed package targets and iOS 17/macOS 14 platforms. Overlay alone with stale default cache still failed |
| Initial host SwiftPM test with that overlay | Manifest/core compiled, then failed `no such module Testing`; added explicit framework/plugin/linker paths to the host-check helper |
| `CLT_CHECK_DIR=/tmp/feature07-clt-check apps/ios/scripts/swiftpm-clt-check.sh` | Exit 0: SwiftPM compiled Core/UI and linked/executed package tests for **arm64 macOS 14**. Runner reports 39 tests in 8 suites; five opt-in test functions (three live Auth, live manual and real Keychain) skipped. All runnable auth/config/wire/manual tests pass. This is **not** an iOS target build |
| `SWIFTC_FLAGS='-vfsoverlay /tmp/feature07-fallback-overlay.json -Xcc -ivfsoverlay -Xcc /tmp/feature07-fallback-overlay.json -Xfrontend -disable-cross-import-overlays' apps/ios/scripts/swiftc-check.sh` | Exit 0: Core/UI/app entry point macOS fallback compiled with warnings-as-errors; same runnable suite passes |
| `bash -n apps/ios/scripts/swiftpm-clt-check.sh`; `git diff --check` | Pass |

New file: `apps/ios/scripts/swiftpm-clt-check.sh` provides the verified temporary CLT workaround, supplies Testing search/link paths, and delegates to normal xcrun SwiftPM when full Xcode is selected. Updated iOS README/current issues/spec status. System files, application behavior and Package.swift remain unchanged. No backend operations were performed in this recheck; no hosted Supabase access, SIMON.md edits or commits.

**Still no simulator app evidence for any requested UI scenario:** sign-in/store/display, blank versus zero, count entry/grouped backend quantities, confirmation/completion, network retry/conflicts, force-quit/relaunch saved scan, session persistence/logout, Dynamic Type layouts, accessibility labels/focus. Prior local macOS client/API evidence remains valid but does not satisfy these iOS checks. **VoiceOver interaction and physical-device checks are separately unverified.** Full Xcode with an iOS SDK must be installed/located and selected before these gaps can be closed. Runtime bootability and macOS SwiftPM success do not justify marking Feature 07 complete.


## Feature 07 — Fresh Full-Xcode / Actual Simulator Verification (2026-10-03)

**Acceptance incomplete.** This section supersedes the earlier missing-Xcode, iOS-build and app-relaunch gaps. Historical probes above describe their environment at that time, not the current installed tools.

### Environment and commands

- Host: macOS **26.6.2 (25G83)**. Full Xcode: `/Applications/Xcode.app`, **27.0 (27A266a)**; Swift **6.4**. XcodeGen **2.46.0** generated the existing project successfully.
- Every build/test/tool command uses `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. No `xcode-select -s` or system/SDK edits were made. Final `env -u DEVELOPER_DIR xcode-select -p` reports the installed Xcode developer directory.
- `xcodebuild -checkFirstLaunchStatus`: exit **0**. `xcrun --find simctl` and both iOS SDK probes succeed; simulator SDK is **27.0**. No additional component is required to build/run the tested app. Xcode 27's simulator UI is **Device Hub**, under `Xcode.app/Contents/Applications/DeviceHub.app`.
- Runtime: **iOS 26.5 (23F77)**. Device: **iPhone 17 Pro**, UUID **C5F3DEA0-0C84-4ED2-84D8-60D0933463CC**. `simctl boot`/`bootstatus`, actual app installation and launch work. No physical-device build/install was performed.
- Plain `DEVELOPER_DIR=… xcrun swift test --package-path apps/ios/DisplayRefillKit` succeeds with the unchanged manifest. The legacy CLT overlay is unnecessary with full Xcode; no Package.swift/compiler-flag workaround is used for these builds.

Initial actual-target compile: from `apps/ios`, `xcodegen generate`, then `DEVELOPER_DIR=… xcodebuild -scheme DisplayRefill -destination 'platform=iOS Simulator,id=C5F3DEA0-0C84-4ED2-84D8-60D0933463CC' -derivedDataPath /tmp/feature07-ios-derived CODE_SIGNING_ALLOWED=NO build`: **BUILD SUCCEEDED**, log `/tmp/feature07-ios-build.log`. That unsigned configuration is **not adequate for Keychain persistence evidence**. It initially returned to sign-in after restart. The harness now uses `CODE_SIGN_IDENTITY=-` with normal simulator signing, which generates the simulated application identity. Real Keychain restoration and persistent logout then pass. Auth/session-store implementation was not replaced or weakened.

Reproducible actual-app test command (from repo root):

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
SIMULATOR_ID=C5F3DEA0-0C84-4ED2-84D8-60D0933463CC \
  node scripts/run-ios-simulator-tests.mjs
```

The script refuses non-loopback Supabase, boots the simulator, builds/starts the real local production API on :3100, and exposes a loopback fault proxy on :3101. It provisions a synthetic employee/store/published POG with two slots and runs the generated **DisplayRefill** scheme using `xcodebuild … CODE_SIGN_IDENTITY=- API_BASE_URL=http://localhost:3101 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<local-public-key> test`. The private ignored fixture is copied only to the UI **test** bundle; the app contains public configuration only. The fixture is removed and synthetic access revoked afterward; retained scan rows remain local. No photo upload, worker/provider invocation or hosted operation occurs.

### Observed functional results

`/tmp/feature07-ios-1791072870320.xcresult` (log `/tmp/feature07-simulator-run12.log`) and `/tmp/feature07-ios-1791073331703.xcresult` (run13 log) contain complete functional assertion passes. **These overall UI suites fail because of accessibility audit findings; they are not reported as passing suites.**

- Genuine Supabase Auth sign-in; assigned **Simulator Store** / active **Simulator Display** selection; start with its published POG and both counts unknown. Unknown disables increment/decrement and confirmation. Explicit **0** stays distinct from blank; direct entry plus Increase/Decrease are exercised.
- Save entries **A1=0**, **A2=2**. The backend returns grouped refill **5**, with expandable slot details **3** and **2**. Revisions and displayed quantities come from the real Feature 06 API. No Swift refill calculation was added.
- Proxy discards a successfully committed save response and returns synthetic **503**. Inputs remain **0/2**; retry sends the same idempotency key and equivalent request body; two HTTP requests produce only **revision 2**, not a second mutation. Existing Swift tests separately assert exact encoded bytes/key under transport/401 retries.
- A second authorized RPC edit advances the scan to revision 3 with different counts. The app's stale save receives **409**; explicit reload keeps **0/2**, requires review/save and successfully saves at **revision 4**. No silent input loss.
- Confirm transitions to immutable **confirmed** state; the employee explicitly accepts the completion dialog. Completion records the actor, status and time, preserves accepted/final/refill slot quantities and total **5**, and does not create another observation.
- **Terminate → launch** restores the real iOS Keychain session. **Saved checks** opens the persisted scan through a fresh server detail fetch, displaying completed attestation and confirmed counts **0/2**. **Sign out → terminate → launch** stays at sign-in with no assigned-store screen.
- The app's numeric fields receive keyboard focus; named controls work; the new Done control dismisses the keyboard. Error/recovery messages now scroll into view and request accessibility focus. Spoken VoiceOver focus/announcements are not inferred from that source or from keyboard tests.

### Accessibility results and unresolved acceptance

- The harness sets `simctl ui <UUID> content_size accessibility-extra-extra-extra-large`, captures real simulator screens, then returns to normal size/restores the prior reported setting when possible.
- Native `performAccessibilityAudit` checks element descriptions, hit regions, Dynamic Type and clipped text. Description/hit-region checks and the largest count-entry audit pass. Count fields scale in height, controls stack vertically at accessibility sizes, and text can wrap vertically. This is actual iOS evidence, not macOS font behavior.
- **Clipped-text audits remain failing**, including the product refill label, completed-attestation label/date and reports without a resolvable element. The latest run, `/tmp/feature07-ios-1791074124029.xcresult` / `/tmp/feature07-simulator-run14.log`, also flags the test helper's conservative attempt to make the entire largest refill label visible. Full-width/multiline sizing, unrestricted line limits and layout priority did not produce a clean audit. Do not classify these warnings as false positives without further inspection.
- Overall latest `xcodebuild test` exits **65**. All completed-flow/relaunch/logout assertions have evidence from signed runs, but a **passing full iOS UI suite and complete Dynamic Type/accessibility acceptance are still missing**. Remaining work: inspect the unresolved native audit elements in Accessibility Inspector, verify every affected row/expanded group at large sizes, correct genuine clipping or document a proven tool limitation, then rerun the suite. [Apple's audit guide](https://developer.apple.com/documentation/accessibility/performing-accessibility-audits-for-your-app) describes these as potential clipping concerns at larger sizes.
- **VoiceOver separately unverified:** spoken labels, swipe focus order, adjustment gestures, error announcements and confirmation/completion dialog focus were not exercised end-to-end.
- **Physical device separately unverified:** iOS 17 minimum compatibility, real Keychain/provisioning, touch/keyboard behavior and device/network/background operation remain untested. No hosted Auth/email or paid provider test was performed.

### Changes and regression evidence

- `ManualCheckView.swift`: scroll/focus recovery notices; slot-specific keyboard focus + Done; short Unknown placeholder; scaled count-field height; vertical accessible-size count controls; multiline informational/refill/completion text. Counts/refill authority, confirmed immutability and API/Auth behavior remain unchanged.
- `apps/ios/project.yml`, `Verification/ManualWorkflowUITests.swift`, `scripts/run-ios-simulator-tests.mjs`: generated-project UI test target and repeatable real local workflow/fault injections. Missing private fixture causes an explicit opt-in skip in an ordinary scheme test.
- `apps/ios/README.md`: full-Xcode/session environment, simulator signing and harness instructions. The earlier host-only CLT helper is retained as an optional legacy fallback.
- Full-Xcode SwiftPM: **39 tests / 8 suites reported passing**, with **five opt-in live/Keychain tests skipped**. Real local Auth/Keychain/manual behavior is exercised by the separate iOS UI harness. Final log `/tmp/feature07-full-xcode-swift-final4.log`.
- Actual iOS Core regression suite: **39 tests / 8 suites reported passing**, same opt-in skips, within the generated scheme. This is distinct from the macOS SwiftPM pass.
- `npm run typecheck`, `npm run lint`, `npm test`: exit **0**, all workspace checks and **110/110** TS unit tests. Logs `/tmp/feature07-typecheck.log`, `/tmp/feature07-lint.log`, `/tmp/feature07-unit.log`.
- `DOCKER_HOST=… npm run test:db`: exit **0**, **120/120** local DB tests; no schema reset/migration changes in this verification pass. Log `/tmp/feature07-db-regression.log`.
- `DOCKER_HOST=… npm run test:api`: exit **0**, **80/80** local API integration tests across eight files, 89.50 seconds. Log `/tmp/feature07-api-regression.log`.
- `npm run check:client-config`, `npm run check:db-scripts`, `node --check scripts/run-ios-simulator-tests.mjs`, `git diff --check`: pass.

No Feature 08 work, SIMON.md edits, hosted Supabase operations or commits were made. **Next unit remains Feature 07 accessibility investigation, not Feature 08.**


## Feature 07 — Dynamic Type Layout Fix and Final Native UI Checks (2026-10-03)

**Native UI failures resolved; Feature 07 remains not acceptance-complete.** This section supersedes the earlier open clipping/reachability findings. Spoken VoiceOver, speech announcements and focus-order operation have not been exercised. Physical-device checks remain separately unverified. Feature 08 has not started.

### Failure evidence and fixes

- Read the tracker, current issues, UI context and Feature 07 spec; inspected the prior failed log `/tmp/feature07-simulator-run14.log` and exported its screenshot/diagnostic attachments from `/tmp/feature07-ios-1791074124029.xcresult`. The prior run had seven native text-clipping findings and one full-label reach failure. The product, completion and date/action rows used the Form/table layout path.
- `ManualCheckView.swift` now uses a native vertical ScrollView with content-sized sections. Section headings have header traits. Informational/validation text remains multiline; action labels wrap with content-sized height and a minimum 44-point touch target. Native semantic fonts, unrestricted Dynamic Type, scaled count-field heights, vertical accessibility-size count controls, slot-specific keyboard focus and Done remain supported. Disabled actions retain a semantic disabled color.
- Product disclosure labels present the product name and server quantity on separate rows. Their combined accessibility label still identifies product and refill quantity; expandable slot details remain available. No authoritative quantity calculation or API/Auth behavior changed.
- First rerun of the original UI test: **exit 0**, **1/1 UI test**, zero failures, 216.504 seconds. Log `/tmp/feature07-layout-run1.log`, bundle `/tmp/feature07-ios-1791075991946.xcresult`. The original clipping audits and full-label bounds assertions passed without exclusions.
- Expanded rerun: the full largest-size workflow passed (470.667 seconds), but the repeated default scenario exposed intermittent coarse-scroll overshoot at its largest-size disclosure checkpoint. Overall **exit 65**; log `/tmp/feature07-layout-run2.log`, bundle `/tmp/feature07-ios-1791076257322.xcresult`. This is retained as failed evidence, not a passing suite.
- The reach helper now uses measured slow drags near full-label bounds. It retains the same navigation/keyboard/tab-bar clearance, full-label visibility and hittability conditions, and the same bounded attempts. Final diagnostics show the refill label advancing from y=1127.33 to 875.33 to 623.33 points, then a measured final drag into the viewport 124…784. Completion labels likewise reach these bounds. No assertions or audit categories were removed; no findings are filtered or called false positives. No text is shrunk, accessibility sizes capped, or required content removed.
- UI tests now execute both a default-size workflow and a workflow whose manual entry, retry/conflict, confirmation and completion use the largest size. Added native audit checkpoints cover unknown-count validation and retry/conflict messages. The test-only local controller resets its observation ledger between scenarios; server idempotency records remain intact.

### Actual final environment, commands and results

Environment: **Xcode 27.0 (27A266a)** at `/Applications/Xcode.app`; iOS Simulator SDK **27.0**; **iPhone 17 Pro**, UUID **C5F3DEA0-0C84-4ED2-84D8-60D0933463CC**, runtime **iOS 26.5 (23F77)**; host macOS **26.6.2 (25G83)**. Every Xcode command used session-scoped `DEVELOPER_DIR`; system toolchain selection was not changed.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
node scripts/run-ios-simulator-tests.mjs
```

The harness generates the actual Xcode project, builds/signs the app with `CODE_SIGN_IDENTITY=-`, and executes `xcodebuild -scheme DisplayRefill -destination 'platform=iOS Simulator,id=C5F3DEA0-0C84-4ED2-84D8-60D0933463CC' -derivedDataPath /tmp/feature07-ios-derived -parallel-testing-enabled NO … test`. Local public configuration points at API/proxy localhost:3100/3101 and Supabase 127.0.0.1:54321. Service credentials stay in the local provisioning process. The private fixture is test-bundle-only, removed afterward; synthetic access is revoked.

**Final result: exit 0, `TEST SUCCEEDED`, 2/2 iOS UI tests, zero failures.** Largest-size scenario: **411.367 seconds**; default-size scenario (including largest-size checkpoints): **182.342 seconds**. Final log `/tmp/feature07-layout-run3.log`; valid bundle `/tmp/feature07-ios-1791077097962.xcresult`; exported screenshots `/tmp/feature07-layout-final-attachments`. The app was built and run on iOS; this result is independent of host SwiftPM.

Observed in both scenarios:

- Real Supabase employee sign-in, assigned store/active display, published-POG manual creation; vision absent.
- Blank counts remain Unknown, explicit 0 remains 0; missing counts block confirmation. Native numeric entry and named increment/decrement actions work with the keyboard; Done dismisses it. Count fields grow by more than 1.5× at the largest size.
- Server revision/quantities drive grouped refill 5 and slot details 3/2. Product names and quantities wrap, and full disclosure/completion labels can be scrolled within the unobscured viewport.
- Native `.sufficientElementDescription`, `.hitRegion`, `.textClipped` and `.dynamicType` audits pass at the unknown-validation, retry, conflict, count, refill and completion checkpoints. Screenshots were exported and inspected. Native audits do not establish spoken VoiceOver or focus-order operation.
- Discarded committed-save response: exact key/equivalent body replay, retained 0/2, revision 2. Competing revision: safe 409, explicit reload retains 0/2, save advances to revision 4. Recovery actions remain reachable at the largest size.
- Confirmation freezes the saved counts. Completion records the synthetic employee attestation while the backend slot snapshot and refill total remain unchanged.
- Process termination/relaunch restores the actual Keychain session; saved-scan ID reopens completed server detail with counts 0/2. Logout persists across another process termination/relaunch.

### Regression checks and the five intentional Swift skips

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --package-path apps/ios/DisplayRefillKit`: **exit 0, 34 executed tests pass; five opt-in tests skipped** (runner reports 39 tests / eight suites). Final log `/tmp/feature07-layout-swift-final3.log`. The actual iOS scheme's Core tests also pass with the same intentional skips.
- `npm run typecheck`, `npm run lint`, `npm test`: **exit 0**, **110/110** TypeScript unit tests. Logs `/tmp/feature07-layout-typecheck.log`, `/tmp/feature07-layout-lint.log`, `/tmp/feature07-layout-unit.log`.
- `npm run check:client-config`, `npm run check:db-scripts`, `node --check scripts/run-ios-simulator-tests.mjs`, `git diff --check`: pass. Client artifacts contain only publishable configuration.
- No production backend/schema changes were made in this fix. The earlier 120/120 DB and 80/80 API regressions remain applicable to the unchanged backend; this turn additionally exercises its real manual endpoints through both native workflows. Those full DB/API suites were not rerun in this layout-only pass.

| Intentionally skipped test | Why opt-in | Feature 07 evidence / limitation |
| --- | --- | --- |
| Live Auth: `signInLoadsOnlyAuthorizedStoresThenRefreshesAndSignsOut` | Needs isolated loopback fixture credentials (`DISPLAY_REFILL_LIVE=1`) | Real sign-in/store authorization and logout are exercised by the native UI harness. Forced expired-token refresh is covered by ordinary unit tests, not exercised by this UI run |
| Live Auth: `invalidRefreshTokenReturnsToSignInWithoutLooping` | Needs a running loopback Auth/API fixture | Ordinary refresh/unauthorized tests pass; invalid-refresh server integration was not rerun by this opt-in suite |
| Live Auth: `passwordResetRequestIsAccepted` | Makes a local Auth/API reset request | Feature 03 behavior, outside the manual Feature 07 acceptance flow; not rerun here |
| Live Manual: `actualSwiftClientCompletesLocalManualWorkflowAndRestoresSession` | Needs synthetic employee/display credentials (`DISPLAY_REFILL_MANUAL_LIVE=1`) | The native UI harness exercises real endpoints and adds actual app-process/Keychain relaunch evidence; prior independent live-client evidence is retained above |
| Keychain: `saveLoadDelete` | Opt-in to avoid ordinary tests writing the runner's real Keychain (`DISPLAY_REFILL_KEYCHAIN_TEST=1`) | Actual simulator app Keychain restoration and persistent logout pass; host-login Keychain suite remains skipped |

The skips are deliberate and are not counted as executed passes. The live manual and Keychain skips do not leave the manual/relaunch/session criteria without evidence because the genuine iOS app exercises them separately. They do not replace or satisfy spoken VoiceOver acceptance. **Remaining required check: spoken VoiceOver navigation, announcements and focus order. Physical-device verification remains separately unverified. Feature 07 is not marked acceptance-complete.** No hosted Supabase operations, SIMON.md edits or commits; no Feature 08 work.

## Feature 08 — State Found at Feature 09 Start (2026-10-03)

The working tree held uncommitted Feature 08 code (migration 13, photo routes, `photo-scans.ts`, iOS `PhotoWorkflow`/`PhotoCheckView`/`PhotoImage`, tests, decisions D57–D61) with **no tracker evidence**; this tracker still said "not started". Observed this session:

- Baseline before any Feature 09 change: `node scripts/run-api-tests.mjs test/photo-scans.test.ts` → **6/6 pass**.
- First simulator photo run: the app **crashed right after a photo was chosen** (A05: collapsed crop-slider range). Feature 08's iOS import had never worked on iOS. Fixed in `PhotoCheckView.cropSlider`; import → upright preview → crop → upload → finalize now passes in the simulator (results under Feature 09).
- `analysis_available` is now `true` (Feature 09); the Feature 08 test was updated accordingly.
- **Still unverified for Feature 08:** real AVFoundation camera capture, camera permission allowed/denied on a device, device background/resume during upload, and weak network. Simulator imports are not evidence of physical camera capture.

## Feature 09 — Implementation and Evidence (2026-10-03, local only)

### What exists
- **Migration 14** `supabase/migrations/20261003001400_vision_pipeline.sql`: `claim_scan_job`, `heartbeat_scan_job`, `finish_scan_attempt`, `scan_analysis_action` (service role only), private `fail_scan_job`; `scans.failure_code`/`ai_summary`/`manual_takeover_at/by`; attempt `job_id`/`lease_token`/`error_code`/`policy_version`/`confidence_threshold`/`input_error`. Decisions D62–D68. Types regenerated (`db:types:check` OK).
- **Domain** `packages/domain/src/vision.ts`: `normalizeVisionOutput`, `REVIEW_POLICY` (`review-v1`, 0.80), `VISION_PROMPT_VERSION` (`count-v1`).
- **Server** `packages/server/src/vision.ts`: typed adapter input (validated image bytes, reference bytes, slots without targets), `VisionProviderError`, 256 KiB response bound, `sanitizeVisionUsage`, `buildVisionPrompt`, mock scenarios; `VISION_MOCK_SCENARIO` config; `createWorkerServiceClient`. `scans.ts`: `analysis` block and `scanAnalysisAction`.
- **Worker** `workers/scan-worker/src/{queue,pipeline,worker,main}.ts`: claim loop (1 s, idle backoff to 10 s, two jobs per process), 20 s heartbeat, 45 s deadline even when an adapter ignores abort, JPEG re-check before the provider, outcome classification, logs with IDs/codes only. Defect A04 fixed: the bundled worker crashed at startup (sharp inlined); `sharp` is now external and a worker dependency.
- **API**: `POST /api/v1/scans/:id/retry`, `POST /api/v1/scans/:id/manual-takeover`; `GET /scans/:id` returns `analysis`; health `job_queue: not_checked`.
- **iOS**: `ScanDetail.analysis`/`source`/slot `aiQuantity`/`reviewRequired`; `PhotoWorkflow.pollAnalysis` (2 s ×5 → 3 → 4 → 5 s; stops outside queued/processing, on background or leaving the screen; resumes by scan ID), 30-second delay notice, `retryAnalysis` with persisted exact body/key, `AnalysisState`/`ReviewSummary`. `PhotoCheckView` gets a "Photo analysis" section with VoiceOver announcements, retry button, synthetic-provider label, and no percentage progress. No AI review/confirmation UI (Feature 10).
- **Tests**: `tests/db/test/vision-pipeline.test.ts` (21), `tests/api/test/vision-pipeline.test.ts` (3), worker unit tests (13), domain normalization (4 new), server vision (3 new), Swift polling/retry (6 new), extended simulator `testPhotoImportCropAndRecovery`, harness `PHOTO_TESTS=1` with `/control/start-worker`.

### Acceptance criteria → evidence
| Criterion | Evidence |
| --- | --- |
| Mock good/poor-alignment/occluded/invalid responses produce correct review or failure state | DB: good → needs_review, revision 2→3→4, accepted copies, no review; poor → all null + review; occluded → slot null/occluded, every slot reviewed (image flag); invalid → one retry then `failed`/`INVALID_OUTPUT`. API: mixed → `A1` 1 / `A2` null+occluded, `unresolved_slot_ids` only A2, provisional total null; retry → poor alignment all unknown. Simulator: review-ready summary "1 of 2 slots have estimates; 1 need verification" with synthetic label |
| Timeout, retryable and permanent errors follow the budget | DB: 5xx → requeued 3.5–6.5 s; 429 Retry-After 120 → ~120 s; third attempt (provider never answers, 50 ms test deadline) → `failed`/`PROVIDER_TIMEOUT`, attempts 1–3 recorded; Retry-After 86400 capped at ~300 s; `PROVIDER_CONFIGURATION` fails after 1 attempt. Explicit retry: creator/manager only, stale revision 409, idempotent replay, fresh generation budget, third retry → `RETRY_LIMIT`. Worker units: deadline enforced when the adapter ignores abort |
| Worker restart reclaims expired work without duplicating accepted results | DB: expired lease reclaimed as attempt 2 with a new token; attempt 1 → `timeout`/`LEASE_EXPIRED`; the slow holder's late result and a third duplicate delivery are `fenced`; one commit, one audit event, original revision kept, billing usage of the dead attempt retained. Lease expiry on attempt 3 → `ANALYSIS_TIMEOUT`. Six concurrent claims → exactly one claim/attempt. Store limit: 2 live leases in store A, store B still served, freed slot admits the third |
| Manual takeover during a provider call prevents late writes | DB: takeover while the adapter is blocked → late success `fenced`; scan `needs_review`/`manual`, generation 1, `ai_summary` null, all AI/accepted null and pending, job cancelled, attempt `cancelled`/`MANUAL_TAKEOVER` with the late usage recorded, heartbeat false, nothing claimable; Feature 06 counts then succeed. A 25 ms heartbeat aborts a hanging provider call after takeover. Takeover from awaiting_upload expires the intent and blocks upload authorization. API: peer 403, manager 200, counts + confirm afterwards (total 4) |
| Missing slot output becomes unknown; wrong/duplicate IDs cannot be accepted | Domain units; worker units; DB: missing → null/ambiguous; duplicate and unknown IDs → `INVALID_SLOT_IDS`, no AI values written. SQL refuses (VALIDATION_FAILED) a normalized result with a missing slot, a foreign slot, an extra field, or a known count under poor alignment, and recomputes review (supplied `review_required:false` with confidence 0.5 → stored as review required) |
| Provider/model/prompt versions and usage recorded without leaking secrets | DB: attempt row has provider, model, `count-v1`, schema 1, `review-v1`, threshold 0.8, input sha256/dimensions, sanitized usage. A provider error containing a sentinel key and a signed-style URL, and usage carrying `authorization`/`signed_url`, leave **no trace** in attempts, jobs, scan, audit metadata or worker logs. Clients get `42501` reading jobs/attempts; another organization sees no scan |
| Polling states exposed to iOS | API `analysis` block; Swift tests for schedule, review-ready summary, 30 s delay with no worker, connectivity loss, poor alignment, retry with exact body/key after a lost response, failed-without-retry/takeover/404 stop. Simulator: queued → delay notice with no worker → worker started → review-ready → relaunch resumes |

### Negative control
`finish_scan_attempt` was temporarily redefined in the local database with `v_fenced := false`: **3 tests failed** (expired-lease reclaim, takeover during provider call, heartbeat abort after takeover). Restoring the migration's definition: 21/21. The database was later reset from empty for the full suites.

### Commands and observed results (macOS 26.6.2, Node 22.13.1, local Supabase on Colima)
| Command | Result |
| --- | --- |
| `npm run db:reset` (from empty, migrations 1–14 + seed) | exit 0 |
| `npm run db:types:check` | OK, types match applied schema |
| `npm run test:db` | **141/141**, 11 files (21 new in `vision-pipeline.test.ts`) |
| `npm run test:api` | First run after reset: **88/89**. Feature 07 concurrent manual create returned 500 twice (A06, not reproduced). Two further full harness runs plus one manual-server run: **89/89** each |
| `npm test` | **128/128** (admin 3, domain 67, server 45, worker 13) |
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:client-config`, `npm run check:db-scripts`, `git diff --check` | all exit 0 |
| Bundled worker `node workers/scan-worker/dist/main.js` | starts after A04 fix; used by the simulator harness to process the job |
| `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift test --package-path apps/ios/DisplayRefillKit` | exit 0: 46 tests reported, 41 executed, the same 5 opt-in tests skipped |
| `DEVELOPER_DIR=… PHOTO_TESTS=1 node scripts/run-ios-simulator-tests.mjs` (iPhone 17 Pro sim, iOS 26.5, Xcode 27.0) | Run 1: test compile error (await in autoclosure). Run 2: app crash on import (A05). Run 3: all analysis checkpoints passed, then the sign-out step couldn't reach the tab bar from the nested screen (test navigation). **Run 4: TEST SUCCEEDED**, photo UI test 134.6 s, 48 on-simulator Core tests pass; bundle `/tmp/feature07-ios-1791081751918.xcresult`, log in session scratchpad `feature09-ios-photo-run4.log` |
| `DEVELOPER_DIR=… node scripts/run-ios-simulator-tests.mjs` (full suite, Feature 07 regression) | **TEST SUCCEEDED**: 3/3 UI tests: largest-size manual workflow 539.4 s, default manual workflow 180.4 s, photo/analysis 136.3 s; 48 Core tests; bundle `/tmp/feature07-ios-1791082345298.xcresult`, log `feature09-ios-full.log` in session scratchpad |

Screenshots exported and inspected: upright crop, "Photo queued for analysis. This is taking longer than usual. Keep waiting, or start a manual check." (indeterminate spinner only), review-ready summary with the synthetic-provider warning, wrapping at the largest accessibility size, manual fallback. Native `.sufficientElementDescription/.hitRegion/.textClipped/.dynamicType` audits passed at the delayed, review-ready and largest-text checkpoints.

### Not verified / outstanding
- **Real vision provider:** none selected; the benchmark (held-out photos, exact-count accuracy, unknown rate, high-confidence error) and data-handling review (retention, training use, region) have not started. Only `VISION_PROVIDER=mock` is accepted, and mock output is labeled synthetic. No paid API was called.
- **Spoken VoiceOver** for the new analysis announcements and the retry button, and the Feature 07 focus order: unverified.
- **Physical device:** a paired iPhone (iPhone17,1, "La boo boo") is listed by `devicectl`, but no device build/install/run was attempted. It needs your signing team, a LAN-reachable local API/Supabase and a person operating the camera.
- **Not implemented here:** 24-hour `awaiting_upload` → `UPLOAD_EXPIRED` sweep (R12), operator vision-disable switch, cost telemetry and multi-host worker deployment (Feature 12); AI-estimate review/acceptance UI and the iOS takeover action (Feature 10).
- A06 transient 500 after a container restart: open.

### Device checks you need to perform (iPhone, local synthetic backend reachable over LAN)
1. Camera permission: first launch → Photo check → Take photo → **Allow**; capture the display in portrait and landscape; confirm the preview is upright and the crop outline matches.
2. Deny camera (Settings → Display Refill → Camera off): confirm the denial message, the Settings button, Photos import and the manual check all work.
3. Import a HEIC photo from the library; confirm upload succeeds (server stores a JPEG without location metadata).
4. Upload over weak Wi-Fi or with airplane mode toggled mid-upload; retry must reuse the same photo and must not create a second scan.
5. With the worker stopped: confirm "queued" then, after 30 s, the delay notice with the manual option. Start the worker (`VISION_MOCK_SCENARIO=mixed`): the summary and synthetic warning appear without relaunch. Background the app during processing, return, and confirm polling resumes.
6. Run worker scenarios `poor_alignment` and `invalid` (twice): confirm the alignment message, and the failed state with **Retry analysis** working once per generation.
7. VoiceOver on: confirm status changes are announced, the retry button is reachable, and focus order on the photo screen is sensible; repeat the Feature 07 manual flow focus-order check.

No hosted Supabase operations, SIMON.md edits or commits were made.

## Feature 10 — Implementation and Evidence (2026-10-03, local only)

### What exists
- **Migration 15** `supabase/migrations/20261003001500_review_corrections.sql`: nullable `scan_corrections.verified` (written true/false by every save from now on; null only for earlier rows); `guard_scan_slot` also refuses clearing `review_required` once a scan is in review; `mutate_scan_counts` records the flag (otherwise identical to migration 11; diffed). Types regenerated. Decisions D69–D73.
- **Server**: mock scenario `review` (low confidence 0.62, wrong_product, null confidence, high confidence 0.97, cycling). No API route or response-shape change.
- **iOS Core**: slot `confidence`/`flags`; `ManualWorkflow` photo-scan review mode (`orderedSlots`, `review(of:)`, explicit `checked` acceptances, `canSave`/`canConfirm`, items only for corrections and checks with derived reasons); `ReviewReason` explanations; `PhotoWorkflow.takeOver()` with persisted exact body/key and 409 reload. Manual and taken-over scans keep the Feature 07 save unchanged.
- **iOS UI**: count screen shows AI estimate, saved count, reasons, text+icon status; required slots first; "I checked: N is correct" (switch semantics); confirmed scans show "Found a mistake?" with "Start a new check of this display". Photo screen: "Review estimates and counts" / "Enter counts for this scan" and "Stop analysis and enter counts for this scan".
- **Defect fixed (A07)**: re-importing the same library photo for a new scan did nothing (stale `PhotosPicker` selection).
- **Tests**: `tests/api/test/review-corrections.test.ts` (3), server unit (1), Swift `ReviewWorkflowTests.swift` (6) + 2 takeover tests in `PhotoTests.swift`, simulator `testEstimateReviewCorrectionAndTakeover`, harness `REVIEW_TESTS=1`, `start-worker?scenario=`, `stop-worker`, snapshot correction rows. One Feature 06 API fixture now bypasses triggers explicitly (it fakes worker evidence by clearing `review_required` after review began, which the new guard correctly refuses); its assertions are unchanged.

### Acceptance criteria → evidence
| Criterion | Evidence (local; vision output is the deterministic **mock**, labeled synthetic) |
| --- | --- |
| Low/null confidence, quality flags and unknowns require explicit review | API: `review` scenario → A1 0.62, A2 wrong_product, A3 null confidence `review_required`, A4 0.97 not; `unresolved_slot_ids` = A1–A3; confirm → 422 `UNRESOLVED_COUNTS` with those IDs. Unit: normalization of the scenario. Swift: required slots first, confirm blocked. Simulator: "2 of 2 slots need your check", Confirm and Save disabled |
| Accepting an unchanged estimate records verification | API: correction row previous 3 → 3, original_ai 3, `visibility_check`, `verified=true`; a `verified:false` same-value save records `verified=false` and stays unresolved. Simulator: checkbox → ledger item `{3, verified, visibility_check}` and server correction row `verified=true` |
| Human correction never overwrites AI evidence | API: AI quantity/confidence/flags/review_required identical before and after saves and confirmation; database owner cannot update `ai_quantity`, clear `review_required`, or update/delete correction rows. Simulator: AI values `[3, 2]` unchanged after correction to `[3, 1]` |
| Edits recalculate through the backend and increment revision atomically | API: revision +1 per save; slot refills equal the domain calculator `[2,4,2,3]`, provisional total 11; clients sending AI fields or totals → 422 |
| Two-device edits conflict safely; confirmed scans reject correction | API: owner and manager saving the same revision concurrently → exactly one 200 and one 409, one correction row; stale revision 409; after confirm, counts (owner, manager), takeover → 409, corrections/evidence unchanged, direct slot update `IMMUTABLE`. Swift: conflict keeps checks/corrections and resends only what still differs at the new revision |
| New scan offered for a confirmed mistake | API: new scan for the same display after confirmation → 201, confirmed scan unchanged. Simulator: "Start a new check of this display" opens the start screen and creates nothing until started |
| Manual takeover from stalled/failed analysis | API: takeover from failed → manual, all unknown/pending, image kept, idempotent replay, retry then 409. Swift: offered only after the delay notice or failure; exact body/key replayed after a lost response; 409 shows the analysis that finished first. Simulator: no worker → delay notice → takeover → same scan opens with unknown counts, server `source=manual` |
| Authorization and failure paths | API: peer employee 403, other organization 404, no session 403 (no bearer/same-origin), peer takeover 403 |

### Negative control
The pre-Feature 10 `guard_scan_slot` and `mutate_scan_counts` were reapplied to the local database: `review-corrections.test.ts` **2 of 3 failed** (verified flag missing; `review_required` clearable). `npm run db:reset` from empty restored migration 15; 3/3 again.

### Commands and observed results (macOS 26.6.2, Node 22.13.1, Xcode 27.0, local Supabase on Colima)
| Command | Result |
| --- | --- |
| `npm run db:reset` (migrations 1–15 + seed), `npm run db:types:check` | exit 0; types match |
| `npm run test:db` | **141/141** |
| `npm run test:api` | Run 1: **91/92**, a test failed in `refill.test.ts` (Feature 06 fixture, fixed as above). Run 2: **91/92**, "Feature 07 creates/reopens/completes…" failed; **failure detail was not captured**; that file alone then passed 10/10. Runs 3–4: **92/92**. A06 stays open, cause unknown |
| `npm test` | **129/129** (admin 3, domain 67, server 46, worker 13) |
| `npm run typecheck`, `lint`, `build`, `check:client-config`, `check:db-scripts`, `git diff --check` | all exit 0 |
| `xcrun swift test --package-path apps/ios/DisplayRefillKit` | exit 0: 54 reported, 5 opt-in skipped (host runner; 49 executed). The host log was not kept, so this count was not re-derived |
| `xcodebuild … build` (iOS simulator) | BUILD SUCCEEDED |
| `REVIEW_TESTS=1 node scripts/run-ios-simulator-tests.mjs` | Run 1: test compile error (await in autoclosure). Run 2: A07 found. Run 3: checkbox queried as button (it is a switch). Run 4: tap landed while the audit had scrolled the link under the tab bar (test sequencing; frames inspected). **Run 5: TEST SUCCEEDED**, UI test 162.9 s, 56 on-simulator Core test cases (51 passed, 5 opt-in skipped); bundle `/tmp/feature07-ios-1791085145911.xcresult` (57 cases: 52 passed, 5 skipped); no accessibility audit issues at default or largest size |
| Full suite run 1 `node scripts/run-ios-simulator-tests.mjs` | **exit 65, TEST FAILED**. Bundle `/tmp/feature07-ios-1791085834655.xcresult`: 60 tests, 54 passed, 1 failed, 5 skipped. Core 56 cases: 51 passed, 5 skipped; Feature 10 UI 162.8 s, largest-size manual 458.4 s, default manual 197.6 s passed; `testPhotoImportCropAndRecovery` failed (157.5 s): the worker started by the Feature 10 test (`review` scenario) was still running, so the photo test's "no worker yet" premise was false (analysed immediately, accepted `[3,2]`). Harness defect introduced this session; fixed with `/control/stop-worker`, called by both tests that need an idle queue; assertions unchanged |
| Full suite run 2 (after the `stop-worker` fix) | **exit 0, TEST SUCCEEDED**. Bundle `/tmp/feature07-ios-1791086875798.xcresult`: 60 tests, **55 passed, 0 failed, 5 skipped** (opt-in live suites). Core 56 cases: 51 passed, 5 skipped; UI 4/4; Feature 10 review/takeover 159.7 s, largest-size manual 423.6 s, default manual 180.1 s, photo import/analysis 131.0 s; no accessibility audit issues logged. Features 07–09 simulator workflows did not regress |

### Test-total reconciliation (Feature 11 session, from existing bundles; no tests rerun)
`xcrun xcresulttool get test-results tests` on the three Feature 10 bundles, counted per test case:

| Bundle | Core cases | UI cases | Total |
| --- | --- | --- | --- |
| `…1791085145911` (REVIEW_TESTS run 5) | 56: 51 passed, 5 skipped | 1: 1 passed | 57: 52 passed, 5 skipped |
| `…1791085834655` (full run 1) | 56: 51 passed, 5 skipped | 4: 3 passed, 1 failed | 60: 54 passed, 1 failed, 5 skipped |
| `…1791086875798` (full run 2) | 56: 51 passed, 5 skipped | 4: 4 passed | 60: **55 passed**, 0 failed, 5 skipped |

The earlier "Core 56/56" wording counted the five opt-in skips as passes; corrected above. The bundle's per-device line reports `passedTests: 56` for full run 2 because one parameterized Core test (`rejectsSecretKeysWithoutPrintingThem(key:)`) ran with two arguments and is counted per run there; the top-level summary (55 passed) counts test cases. The skips are the same five opt-in tests listed under Feature 07. The host `swift test` runner reports a different number (54 tests reported) from the simulator's 56 Core cases; that gap is consistent across sessions (Feature 11: 62 reported on the host vs 64 Core cases in the simulator) and is not explained here.

### Not verified / outstanding (kept separate)
- **Real vision provider:** none selected. All Feature 10 estimate behavior was exercised only with deterministic mock output (`provider: mock`, shown as synthetic). Whether real model confidence/flags route sensibly is unknown until the Feature 09 benchmark.
- **Spoken VoiceOver:** not performed. Native audits (description, hit region, clipping, Dynamic Type) passed in the simulator; that is not a VoiceOver pass. Check: reasons and status are read per slot, the checkbox announces "Checked/Not checked", required-first order matches focus order, and the takeover result is announced.
- **Physical device:** no device build/install/run. Repeat the Feature 09 device list plus: take over a stalled scan, accept one estimate, correct another, confirm, then open "Start a new check".
- **A06:** open; the second full API run failed in the Feature 07 test without captured details. The harness log for future runs should be kept (`node scripts/run-api-tests.mjs > log 2>&1`).
- **Out of scope here:** correction history views (Feature 11); no training/export is performed.

No hosted Supabase operations, SIMON.md edits or commits were made.

## Feature 11 — Implementation and Evidence (2026-10-03, local only)

### What exists
- **No migration.** History uses existing RLS and the `scans (store_id, created_at desc, id desc)` index. Decisions D74–D78.
- **Domain:** `ScanHistoryQuery` (strict filters, limit 1–100, `from < to`); error code `IMAGE_DELETED` (410).
- **Server** `packages/server/src/scan-history.ts`: `listScanHistory` (newest first, exact-timestamp cursor, 404 for inaccessible store/display/organization filters), `getScanRecord` (same detail presenter as `GET /scans/:id`, pinned context, corrections ordered by time/slot/id, confirmation, completion attestation, image state; names and attempt versions for the store's managers/org admins only), `scanImageAccess` (shared by `GET /scans/:id/image`; 410 for retention-deleted photos).
- **API:** `GET /api/v1/scans` (history), `GET /api/v1/scans/:id/history` (record); `GET /scans/:id/image` now uses the shared function.
- **Web:** `/scans` (store/display/status/date filters as a native GET form, store-zone dates, table, Show more / Back to newest, empty/not-found/expired-cursor/retry states) and `/scans/:id` (Scan facts; separate Provisional recommendation / Confirmed refill quantity / Completion attestation panels; slots with original estimate, uncertainty, accepted, final and refill; corrections; photo panel with loading/deleted/session/failed + Try again; analysis attempts for managers/admins). Dashboard banner text updated (scans now exist; analysis is synthetic only).
- **iOS:** `ScanHistory.swift` (models, `ScanHistoryAPI` on `URLSessionAccountAPI`, `HistoryList` with stale-response discard and load-more retry, `HistoryRecordModel` with photo states), `HistoryView.swift` (History tab, store picker, rows, Load more, record screen, removed-photo message, "Continue this check" for editable scans). Saved checks tab unchanged (D78). Slot `final_quantity` decoded.
- **Tests:** `tests/api/test/scan-history.test.ts` (5), `apps/admin/test/zoned-date.test.ts` (2), domain query test (1), Swift `HistoryTests.swift` (8), simulator `testHistoryPaginationRecordAndRemovedPhoto`, harness `HISTORY_TESTS=1` and `/control/seed-history` (a second synthetic employee owns seeded history); harness now logs control/proxy failure messages (codes/messages only, no credentials).

### Acceptance criteria → evidence
| Criterion | Evidence (local, synthetic data) |
| --- | --- |
| Stable pagination, no duplicates/missing rows under equal timestamps | API: five scans created in one transaction (identical `created_at`) plus others; paging with limit 2 equals the database's `created_at desc, id desc` order exactly, no repeats; a scan created between page requests does not appear in later pages and is first on a fresh first page. Swift: cursor passing, append, defensive de-duplication, last page. Simulator: 25 rows → "Load more checks" → "All N checks shown." with N from the server count |
| Filters do not leak other stores or organizations | API: employee/manager filtering by another store, another store's display, another organization or a seed-org store → 404 with no store name in the body; other-org admin filtering by this org/store/display → 404 and its unfiltered list contains none of this org's scans; admin filters by store, display, status and `from`/`to` narrow exactly; malformed cursor, unknown status/param, reversed range, limit 101 → 422; no session → 401. Web: manager `/scans?store_id=<other store>` → "Store not found", no scan IDs; zoned-date units (Toronto DST day, Kolkata offset, invalid dates) |
| History/detail/image permission consistency | API: for seven identities (two employees and a soon-revoked employee of store 1, its manager, employee of store 2, org admin, other-org admin) × three scans (photo in each store, manual in store 1): listed ⇔ detail 200 ⇔ record 200 ⇔ image 200 (photo) / "no photo" 404 (manual); otherwise all 404; record `scan` equals detail exactly. Store assignment revoked with a live token → list empty, detail/record/image 404, filter 404; org membership revoked → 403. Signed link returns `image/jpeg` |
| Historical names/targets/version unchanged after configuration edits | API: after product rename + archive, v2 (different target) published and assigned, and display rename, the record's `scan`, corrections, confirmation, completion and `pog` (version 1) are deep-equal to before; history row still shows version 1; display name shows the current label (D74, documented in UI copy) |
| Deleted photos show explicit retained-metadata state | API: object removed and `image_deleted_at` set → list `image_state: deleted`, record `image.state: deleted` + `deleted_at`, `image_available: false`, corrections/slots unchanged, image route 410 `IMAGE_DELETED` with the retention message (other org still 404). Swift: deleted state shown without requesting a link; 410 after load → removed message. Simulator and browser: "Photo removed under retention policy. Counts and review history remain." |
| Completion not mislabeled as detected stock/measured refill | Separate fields (`confirmation` vs `completion.attested_*`) and panels; copy: "Completion attestation … does not record a new stock count and was not checked by the camera" (web), "This is an attestation, not a new stock count." (iOS); provisional totals labeled "Provisional recommendation … Not confirmed"; list shows refill only when confirmed. Synthetic mock analysis labeled on rows and records |
| Employee cannot alter another employee's scan via detail route | API: `PATCH/PUT/DELETE /scans/:id` and `POST /scans/:id/history` → 405; peer count save → 403; revision unchanged |
| Manager review of assigned stores; admin organization-wide | API/web: manager sees store 1 only (names + analysis versions visible); admin sees both stores; employee sees store-wide history and records without staff names or attempt metadata; employees redirected from the web dashboard to `/no-access?reason=employee` |

### Negative control
`getScanRecord` temporarily read the scan with the service client instead of the caller's client: the consistency test **failed** (store-1 employee got 200 on store 2's record). Restored (file compared byte-for-byte with the backup); 5/5 again.

### Commands and observed results (macOS 26.6.2, Node 22.13.1, Xcode 27.0, local Supabase on Colima; logs in this session's scratchpad)
| Command | Result |
| --- | --- |
| `node scripts/run-api-tests.mjs test/scan-history.test.ts` | Run 1: 3/5 — the mock-analysis helper claimed an earlier test's queued photo (test isolation), and the web record page threw `Invalid option : option` (`Intl.DateTimeFormat` rejects `dateStyle` with `timeZoneName`; fixed in `formatInZone`). Run 2: **5/5** |
| `npm run test:api` (full, `API_TEST_SERVER_LOG=1`) | Run 1: 96/97 — new test assumed same-transaction correction order (presenter now orders by time, slot label, id). Run 2: 96/97 — new web test pinned v1 after an earlier test assigned v2 (`POG_CHANGED`; helper now pins the display's current version). Runs 3 and 4 (`--no-build`): **97/97**. No A06 symptom; no database reset this session |
| `npm test` | **132/132** (admin 5, domain 68, server 46, worker 13) |
| `npm run typecheck`, `npm run lint`, `npm run db:types:check`, `npm run check:client-config`, `npm run check:db-scripts`, `git diff --check` | all exit 0 / OK |
| `xcrun swift test --package-path apps/ios/DisplayRefillKit` | exit 0: 62 reported (8 new), 5 opt-in skipped |
| `HISTORY_TESTS=1 node scripts/run-ios-simulator-tests.mjs` | Run 1: seed endpoint 500 (image path did not match the validated-image constraint; harness now logs control failures). Run 2: summary row not found (lazy rows below the fold). **Run 3: TEST SUCCEEDED**, History UI test 237.6 s; bundle `/tmp/feature07-ios-1791089198445.xcresult`: 65 cases = Core 64 (59 passed, 5 skipped) + UI 1 passed; no accessibility audit issues |
| Full suite run 1 | **exit 65**: bundle `/tmp/feature07-ios-1791089987896.xcresult`. Feature 10 and photo tests passed; History test could not scroll to the summary with more/taller rows in the store, and it left the app signed in, so both manual workflow tests failed at the sign-in step. Test fixed (flick until the lazy element exists; sign out at the end); app code unchanged |
| Full suite run 2 | **exit 0, TEST SUCCEEDED**. Bundle `/tmp/feature07-ios-1791090482541.xcresult`: 69 cases = Core 64 (**59 passed, 5 opt-in skipped**) + UI 5 (**5 passed**): Feature 10 review 161.1 s, History 243.7 s, largest-size manual 444.2 s, default manual 219.9 s, photo 145.8 s; 0 accessibility audit issues logged |
| Browser pass (agent-browser, Chromium, production build on :3200, synthetic org; users disabled afterwards) | Manager: dashboard store list excludes the unassigned store; filters set and submitted with the keyboard (focus + Enter on Apply), times in America/Toronto (EDT); record opened via keyboard; retained photo loads (400 px wide, alt text); deleted photo shows the retention message; other store's URL → "Store not found"; 390 px viewport has no page-level horizontal scroll; cleared cookies → `/sign-in?next=%2Fscans`. Full-page record screenshot reviewed. Note: Chromium's closed native `<select>` ignored synthetic ArrowDown via CDP, so values were set with `select`; native select keyboard operation itself was not re-proven by this tool |

Screenshots reviewed: iOS first page, completed record, largest-size attestation (wraps without clipping), removed-photo record; web completed record.

### Not verified / outstanding
- **Spoken VoiceOver** for the History tab, rows and record (native audits passed; not a VoiceOver pass). Check: row reads as one element with status and refill, Load more and the count line are reachable, section headers navigate, removed-photo message is read.
- **Physical device:** not attempted. Repeat the History flow on the iPhone with a LAN-reachable local backend; confirm photo link loading and expiry renewal over Wi-Fi.
- **Web screen reader:** not tested; only keyboard and accessibility-tree checks.
- **Retention job:** Feature 12. Deleted-photo behavior was exercised by setting `image_deleted_at` and removing the object directly.
- **Real provider:** none; analysis metadata and estimates shown in history come from the synthetic mock only.
- Display/store/POG template names are current labels, not snapshots (D74).
- **A06:** open, not reproduced (no reset this session).

No hosted Supabase operations, SIMON.md edits or commits were made.
