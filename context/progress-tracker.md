# Progress Tracker

## Current Phase
Phase 4 — Local pilot preparation; release acceptance incomplete. Features 04–06 are verified locally. Feature 07 runs as an actual iOS app; spoken VoiceOver/focus order and physical-device use remain unverified. Feature 08 (photo capture/storage) was found implemented but unrecorded at the start of the Feature 09 session; its backend tests pass, and its simulator import flow now passes after an import crash was fixed (A05). Physical camera capture is unverified. Feature 09 (durable analysis) is implemented locally with the deterministic mock adapter only; no real vision provider is selected. Feature 10 (estimate review/corrections) is implemented and verified locally against that mock output; spoken VoiceOver and physical-device checks remain open. Feature 11 (history and manager review) is implemented locally on iOS (simulator) and web; spoken VoiceOver and physical-device checks remain open. Feature 12 operations/retention foundation is implemented locally with synthetic evidence; hosted/policy acceptance remains open. Feature 13 local preparation has begun; no store trial or real-provider benchmark. Nothing has been applied to hosted Supabase.

## Current Goal
Feature 13: prepare one approved store/display using the [pilot packet](pilot/readiness.md). Resolve actual display/catalog/stocking quantities, provider/photo-use and retention decisions, then run real-device/spoken-accessibility and held-out evaluation. Feature 12 hosting/monitoring/rollback/restore gates remain open. No deployment or distribution is authorized.

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
| 12 Operations/retention | Local foundation implemented; staging/production acceptance outstanding | Migration 17; durable cleanup, shared limits/switch, metrics and runbook; synthetic evidence below |
| 13 Pilot/release | Local preparation started; acceptance incomplete | Readiness/source audit, configuration/evaluation/report/device forms in context/pilot; no store trial or real-provider results |

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

## Feature 12 — Local Operations Foundation (2026-10-03)
Implemented locally; **hosted/staging/production acceptance remains incomplete**. No Feature 13 work, commits, hosted Supabase changes, infrastructure provisioning, real-provider requests or destructive production schedules.

- Migration `20261003001700_operations.sql`: service-only/RLS operational switch, cleanup jobs and shared auth rate windows; narrowly granted RPCs and private trigger helpers. New database types were generated from local schema, not hand-edited.
- API/worker configuration is validated; invalid startup exits 78 with variable/rule diagnostics and no values. Worker concurrency (1–16, default 2), cleanup batch (1–1000, default 100) and retention-day bounds are validated. API auth/invite rate windows are atomic in Postgres, use scoped HMAC identity keys and fail closed; database photo quotas and cross-process two-live-jobs-per-store controls remain intact.
- Structured API response status/request-ID logs and sanitized worker/cleanup outcome logs. Logger strips sensitive nested fields, binary values, exception messages, email/URL/credential-like strings. Operational metrics cover queue age, retries, lease recovery, failures/denominators, processing p95, recorded cost, unknown observations/corrections and cleanup backlog. Mock usage/cost is synthetic or absent, not provider billing evidence.
- `workers/scan-worker/src/retention.ts`: explicit one-batch cleanup, durable five-minute fenced leases, retry/backoff up to 24 hours, recorded final outcome/attempt count/last sanitized error. Storage success/absence alone sets `image_deleted_at`; an interrupted DB finish is reclaimed safely. Retention reserves scan objects under the scan lock and refuses competing AI retry. Metadata, counts, corrections, confirmations, attempt evidence and audit history remain.
- Twenty-four-hour abandoned scans become failed/`UPLOAD_EXPIRED` with takeover available. Orphan staging/losing-finalize cleanup uses a conservative object/intent grace period, known namespaces and reference/pending-intent checks. Every POG version reference, including shared/draft references, is protected. New photo creates/enqueues/claims honor the shared operator vision switch; manual services stay available.
- Runbook now documents startup, single-shot scheduling, project/policy assertions for remote cleanup, migrations/deployment, rollback, backup/Storage manifest responsibilities and isolated restore checklist. Proposed 90-day image/365-day metadata durations still require owner approval; metadata expiry is not implemented. Metrics' `retention_eligible` is the proposed 90-day diagnostic, even if an operator selects a different cleanup duration.

### Verification and retained local evidence
Complete captured output is under `/tmp/feature12-evidence/` (local temporary artifacts, not a durable shared evidence store). Harness source: `scripts/run-api-tests.mjs`; synthetic fixtures: `tests/db/test/operations.test.ts`, `tests/db/test/vision-pipeline.test.ts`, `tests/api/test/scan-history.test.ts`; worker/provider test source: `workers/scan-worker/test/worker.test.ts`. Fixture clock changes use transaction-local replication mode on the loopback-guarded test connection; production immutability triggers are unchanged.

| Check | Observed result / evidence |
| --- | --- |
| Fresh local `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock npm run db:reset`; immediately `API_TEST_SERVER_LOG=1 npm run test:api` | Migration applied/seeding/container restart succeeded; **97/97 API tests passed**, including actual cleanup → history/list deleted state, 410 retention message, counts/corrections preservation and unauthorized 404. Complete harness/build/server output: `reset.log`, `api.log`. A06 did not recur; remains open |
| Full `npm run test:db` after initial integration | **145 passed / 1 failed (146 total)**: catalog security check found PUBLIC execute grants on three new private trigger helpers. Grants revoked in migration; complete output `db.log`. No authorization exception was waived |
| Migration reset after race/security changes; immediate API refill/history tests with `API_TEST_SERVER_LOG=1` | **16/16 passed** (includes A06's concurrent manual-create test and the new operator-switch HTTP denial/manual/history test). `reset-final.log`, `api-after-final-reset.log`. Second reset was justified by final race guards/security grants; A06 again did not recur |
| Targeted DB catalog/operations/vision suites after final reset | **35/35 passed**: private-helper permission invariant, real employee/anonymous denials, retention/missing bytes/repeated run/interrupted cleanup, protected referenced POG bytes, abandoned outputs, atomic shared rate windows, mock provider errors/budgets, expired leases, duplicate/stale delivery, manual takeover and two-active-per-store capacity. `db-final.log` |
| Final cleanup suite after batching/error-evidence refinements and creation-based retention of queued work | **7/7 passed**. Expired queued work is failed/fenced/audited before deletion with manual takeover still available, preserving creation-based expiry during prolonged worker outage. Storage-failure simulation throws a credential/URL sentinel through the real cleanup loop/RPCs; retry and later recovery succeed, without sentinel logs. Null/unbounded batch arguments rejected. `cleanup-final.log`. Isolated organization/objects are synthetic; seed catalog unchanged |
| Final targeted API history/web-session/password-reset/members suites after implementation changes | **36/36 passed**, including new switch denial/manual creation and existing Auth/CSRF/invite/revocation workflows. `api-final.log` |
| `npm test` | **134/134 passed**: admin 5, domain 68, server 48, worker 13. Config bounds and hostile logging checks added. `units-final.log` |
| `npm run typecheck`; `npm run lint` | All six TypeScript workspaces pass; ESLint passes. `typecheck-final.log`, `lint-final.log` |
| API production build/start and invalid-config harness | Build passes; valid loopback startup health 200; invalid APP_ORIGIN exits **78**, sentinel absent. `api-startup-final.log`. An exploratory hook-throw implementation left Next's process running; corrected to explicit EX_CONFIG exit, then checked again. This is local startup evidence, not a hosted deployment |
| `npm run build:worker`; bundled `--once`, `--metrics`, invalid concurrency | Bundle passes; labeled mock self-check passes; actual service-only aggregate metrics returned; bad concurrency exits **78** without sentinel value. `worker-build-final.log`, `process-drills.log` |
| Bundled persistent worker SIGKILL → new process → SIGTERM | First process killed/restarted with operator vision disabled; restarted worker exits 0 on SIGTERM. `process-drills.log`. This verifies local process lifecycle; expired **live-job** recovery/provider failures are the separate deterministic DB/pipeline drills above, not a killed real-provider request |
| Captured-log safety scan | 25 captured logs contained no actual local service credentials/database URL or injected credential/body/prompt/signed-URL sentinels; `log-safety.log`. Binary/nested redaction also passes unit/integration checks |
| `npm run db:types:check`, `npm run check:client-config`, `npm run check:db-scripts` | Generated schema types match; browser/iOS artifacts contain only publishable configuration; seven manifests contain no remote/nonlocal reset commands. Output files have matching names under evidence directory. Diff whitespace check passes outside untouched generator formatting; Supabase's exact generated output contains blank-line whitespace, as in previous generated types |

No passing broad suite was repeated without an implementation/security/fixture change. All mock-provider and scripted-provider drills are **synthetic**; they do not verify a real provider, its latency, pricing, credentials, retention or billing.

### Outstanding acceptance / exact owner choices
1. Approve actual scan-image duration, metadata/correction/audit duration (and any future expiry behavior), abandoned-upload grace, backup expiry and restore handling of retention-deleted media. Metadata deletion and training export stay disabled.
2. Choose API host, persistent worker host, scheduler, trusted proxy/forwarding-header policy, secrets/monitoring ownership and alert sample-size thresholds. Approve global fleet/provider concurrency and cost ceiling before enabling a real provider.
3. Select plan-supported database **and private Storage** backup methods, encrypted access owner, schedule/expiry, restore owner and RPO/RTO; rehearse an isolated full restore including Auth/RLS, object consistency, retained evidence and lease reconciliation.
4. Perform staging independent-host release/restart/provider-outage/manual fallback, monitoring/alert delivery, rollback, backup and restore drills. No staging/production deployment, backup restore or rollback rehearsal was performed here; documented procedures are not rehearsal evidence.

**A06 remains open.** Complete reset/harness/server output is retained for both fresh-reset API runs. Existing spoken VoiceOver/focus/announcement, physical-device, real-camera, real-provider and web-screen-reader acceptance gaps remain open. No new client accessibility/device acceptance is claimed. Feature 13 has not started.


## Feature 13 — Independent Local Preparation (2026-10-03)

Read feature specs 01–13, progress/issues/decisions, testing-and-acceptance, vision, storage/retention, operations, project overview and refill rules. Inspected adapter/config/factory, worker pipeline/queue boundary, local test sources, migration inventory and native workflow sources. Existing worktree contains Feature 12 changes; these were preserved. No application code changed for this preparation.

- [Readiness checklist](pilot/readiness.md): distinguishes implementation, historical local verification and release gates across 01–12; owner worksheet excludes stocking quantities inferred from photographs.
- [Provider choices](pilot/provider-options.md): concrete OpenAI snapshot/configuration, paid Gemini alternative and manual-only option; missing transport/usage/budget/config work and independent external data handling approval. Only mock remains configurable; all existing detections synthetic.
- Real-photo protocol: 30–50 development plus >=20 held-out photos in separate sessions, two-person reconciliation, visible vs physically counted hidden total, freeze and replacement rules. Empty CSV forms and report define denominators for exact counts/unknown/high-confidence error/corrections/latency/cost; no fake measured values.
- [Physical device/spoken accessibility scripts](pilot/device-accessibility.md) prepared, **not executed**. Simulator/native audits and Chromium keyboard history do not prove these pass.
- **A06 remains open**; no fresh reset performed in this session. Existing Feature 12 reset passes do not establish root cause. Prior artifacts under /tmp are temporary, not permanent release evidence.

### Current-session verification
- `npm run check`: exit 0, all six workspace typechecks, ESLint, **134/134 units** (admin 5/domain 68/server 48/worker 13), admin/worker builds, client-config and local-reset script guards pass. Build warns that `apps/admin/src/instrumentation.ts:8` uses `process.exit` unsupported in Edge Runtime; existing Node startup evidence does not validate Edge hosting. Keep as hosting/runtime gate, no blanket warning-free build claim.
- `npm run test:db`: exit 0, **148/148** across 12 files against existing local Supabase; no reset, no hosted database.
- `API_TEST_SERVER_LOG=1 node scripts/run-api-tests.mjs --no-build`: exit 0, **98/98 API tests**, local production build/loopback harness; full temporary harness/server log `/tmp/feature13-api.log`. No fresh reset; no A06 recurrence and no root-cause closure.
- Pilot relative Markdown links resolve; CSV forms have unique headers and no fabricated result rows; `git diff --check -- context` passes. No device/simulator/browser speech run, real camera, real vision, pilot photos, hosted changes, paid requests, schedules or distribution occurred. SIMON.md untouched; no commits.

**Not complete:** actual operator configuration/approval, data policy/provider/budget decisions, measured held-out report, unaided employees, physical iPhone and spoken native/web accessibility, Feature 12 staging/monitoring/rollback/full restore, hosted Auth and authorized controlled distribution. MVP remains incomplete; manual-only requires explicit scope/signoff and the remaining nonvision gates.

### Pilot setup continuation — 2026-10-03 (preparation only)

Prepared `context/pilot/local-device-run.md`: local LAN/backend configuration, Storage URL reachability, temporary Debug-only HTTP/privacy configuration, Xcode signing/install steps and pending camera/manual evidence checklist. Read installed Next CLI guide before preparing launch commands. Read-only device inventory found paired physical iPhone “La boo boo” (iPhone17,1); en0 IP 172.20.10.3. Local Supabase status reachable; catalog query contained test/seed POG names and did not establish any actual selected POG. Owner supplied literal path/store/display placeholders, so extraction remains blocked on actual reference; no slot identities/count inferred. Owner confirmed unit = one sellable package/container. Targets/triggers blank and unapproved; worksheet is not a publishable layout.

Added illustrative provider token-cost calculation and owner decision summary with official pricing/data terms; no provider enabled/called, no photos transferred, no catalog writes/publication, device install or real workflow evidence. All checks pending; pilot/Feature 13 acceptance incomplete. Existing working-tree implementation changes preserved.

### Owner-selected POG and physical iPhone continuation — 2026-10-03

Owner supplied actual temporary Mobile #1 fruit POG path and authorized local preservation plus physical-device synthetic build/install/test. Source verified; preserved at `context/pilot/references/mobile-1-fruit-pog.png`; source/copy SHA-256 equal (`94871850270b6cff83793e6935fd37d3d6d03d17beee4578b00d84ea06585bb2`). Seven labels transcribed left-to-right in `context/pilot/mobile-1-draft.md` and CSV; identity approval pending, one unit = one sellable container, package sizes/targets/triggers blank. Actual store unspecified. No real catalog publication/assignment or external image upload.

Physical La boo boo = iPhone 16 Pro, iOS 27.2 / 24B5089g, Developer Mode enabled. Existing Apple Development identity/team B6FF46PK2A signed Debug app; build/install/launch succeeded. Focused temporary physical XCUITest used existing app and local synthetic Supabase/API, two artificial slots (3/trigger1 and 4/null). First probe failed on nil value vs Unknown placeholder assumption; second failed due **test runner** LAN diagnostics prohibited (-1009), while actual app sign-in/manual create worked. Corrected probe to check placeholderValue and collected server diagnostics from Mac. Final physical test **1/1 passed**, exit 0, ~69.5s: sign-in/display; unknown/zero; counts 0/2; refill5; confirm/completion; authenticated relaunch; logout/relaunch. Server evidence confirms completed revision4, immutable final counts0/2, refill3+2 and null AI quantities. See `context/pilot/device-session-2026-10-03.md`, checks.csv, curated local screenshots/tree/JSON; raw bundles in /tmp/display-refill-device. This is a focused smoke pass, not the full acceptance suite. No worker/provider called, although worker bundle built.

Original Swift tests restored, temporary script/test fixture removed, temporary synthetic identities revoked, test API/proxy stopped, generated project restored. Rebuilt standalone local Debug app for ordinary API :3000 after harness :3101 shutdown. Source Info.plist and Release untouched; temporary HTTP/privacy plist used only for local Debug builds. Current backend :3000 remains owner’s existing process. Camera/HEIC/orientation/upload/network failure/photo mock/takeover/VoiceOver/history/security full scenario and real-photo/ground-truth evaluation remain pending. Owner chose manual/local mock; no paid vision, external photo transfer or hosted deployment. Pilot and Feature13 acceptance remain incomplete.

### Dedicated owner manual-test employee — 2026-10-03

Reverified last-installed Debug artifact public endpoints API :3000 / local Supabase :54321 on Mac LAN 172.20.10.3. Created one explicitly authorized dedicated local employee for retained synthetic pilot fixture; verified email/password Auth plus real API me/store/display access (all 200, employee-only assigned synthetic store). Account intentionally kept active across app restarts; reset removes it. Password excluded from repository; private local credential note mode0600 and direct owner handoff. See device-session-2026-10-03.md. No hosted Supabase change, vision call, publication of actual POG or release acceptance.


### Feature 14 — production worksheet pivot (local implementation, acceptance pending)
Owner confirmed HAVE includes display plus prepared backup and latest finished check per section supplies today's make list. Added separate production items/checks/counts/events, service-only RPCs and authenticated API; four-section SwiftUI Today flow with autosave/retry/conflict handling and filters; web Production page with manager/admin PAR setup and actor/time edit history. Existing scan/POG/history implementation preserved. Real catalog/PAR values were not inferred from screenshots.

Local migrations 18–20 applied additively, without resetting the database or removing the owner's login. Browser testing caught an ambiguous PL/pgSQL record/table alias introduced by migration19's same-day move guard; migration20 corrects it. No claim that earlier passing tests covered that intermediate version.

Verified after correction:
- Targeted database production+catalog suites: **23/23 passed** (14 worksheet, 9 shared schema/security checks); includes current-day draft visibility, immutable snapshots, latest completed replacement, concurrent revision conflict, exact replay and section move rejection. Log `/tmp/production-db-final.log`.
- Focused HTTP worksheet suite **4/4 passed** against a production build and synthetic fixtures, with server logs captured; build passed. Log `/tmp/production-api-final.log`. Full older API/database suites were not rerun this turn.
- TypeScript typecheck and lint passed; unit suites **137 passed** (5 admin, 71 domain, 48 server, 13 worker). Logs `/tmp/production-{typecheck,lint,unit}-final.log`.
- Playwright: real local cookie login, PAR10→12, edit navigation locks, product-named audit entry, four-section HAVE7/0/11/5 → MAKE5/10/0/5 =20, category filter to5, 390px no page overflow. Desktop/mobile screenshots `/tmp/production-web-desktop.png` and `/tmp/production-web-mobile.png`; parent visually inspected. Browser first caught SQL failure above; a later selector failure led to explicit accessible names on summary filters. Final browser script exit0.
- Earlier native host suite: 66 reported including five skips, **61 passed** (four new worksheet tests). ARM64 simulator build succeeded after an initial dual-architecture build ran out of disk. Final native verification of the subsequent draft/discard UI changes is pending and will be recorded below.

Remaining: final native runtime/layout verification, spoken VoiceOver, physical-device testing of this new flow, approved store product/PAR setup, hosting and pilot acceptance. This worksheet update is **not installed on the owner's phone yet**. Earlier app device checks do not establish this new flow. Synthetic browser fixture only; no vision calls, hosted operations, commits, SIMON.md changes, or real stocking target publication. Existing A06 and prior pilot gaps remain open.


Feature14 final native checks (2026-10-04): final ARM64 simulator build **BUILD SUCCEEDED**, `/tmp/production-ios-final.log`. Full host Swift suite reports66 with five intentional opt-in skips: **61 passed, 5 skipped**, `/tmp/production-swift-final.log`. Focused `ProductionWorkflowUITests` default and largest Dynamic Type cases each passed (24.167s /31.811s): actual local sign-in, fruit entry7, server save status, PAR absent, reachable finish action and transition to salad. These are focused checks, not the complete legacy UI suite or an accessibility audit. Full physical-day flow, VoiceOver and physical install remain unverified. Helper final visual evaluation was unavailable because its usage limit was reached; parent inspected browser screenshots directly. Generated Supabase types contain generator-emitted trailing whitespace at lines101/114; left untouched to preserve generated parity.


Final native runner **exit0 / TEST SUCCEEDED**, 2/2 focused UI cases, result `/tmp/production-worksheet-ui.xcresult`. Xcode stalled after tests in its optional `simctl diagnose` child (600s timeout); interrupted only that collector with SIGINT, after which Xcode finalized successfully. Diagnostics are therefore incomplete; test execution was not interrupted. Temporary credential fixture removed and Xcode project regenerated. Native screenshots exported and inspected; preserved under `context/pilot/production-worksheet/`. Largest-size image captures the scrolled finish area with part of the button above the navigation bar; the test proves tappability/transition, not full visibility or a clipping audit. Full accessibility/layout acceptance remains open. Configuration guards passed; generated DB types match the applied local schema.


### Full morning catalog and shared cooler stock — 2026-10-04
Owner supplied the complete list and selected FM-615 University Place, with separate display counts and shared backup counted once. Parsed and validated108 rows (7 fruit mobile,9 salad,51 fruit case,41 veggie), preserving row order, exact names and all PAR values. Five exact duplicate names share catalog identities (103 products). No old HAVE/MAKE or July31 timestamp imported. Source mapping/checklist/CSV/JSON and local import receipt: `context/pilot/morning-item-list/`.

Implemented migrations21–22, optional backup contract, required native backup entry for shared groups, combined backend calculation and manager multi-section product configuration. Current-day group membership changes are guarded; final snapshots/events remain immutable. Shared groups wait for all required sections, then backup/display surplus is allocated once across section shortages in fixed order. No hosted changes or physical install.

Import used a transaction and temporary local importer identity. The first attempt hit LAST_ADMIN on importer retirement and rolled back all store/catalog writes. Retried with a store-scoped manager (not an organization admin), successfully imported all108 rows, retired/banned the importer and preserved its audit identity. Existing retained employee login assigned to FM-615 without changing credentials or removing its synthetic store. The import itself uses real owner-provided catalog/PAR data locally; verification counts stay in isolated synthetic stores.

Tests so far: scoped DB24/24, host Swift67 reported (62 passed +5 opt-in skips), TypeScript137 unit tests and typecheck/lint passed. Final HTTP/shared simulator checks pending below; no broad acceptance claim.


FM-615 verification: retained employee password login plus real API `/me`, production config and day reads passed: store visible,108 rows, no PAR returned, no checks/history counts imported. Full shared HTTP suite **5/5 passed** with fresh production build, log `/tmp/shared-api-final.log`; DB24/24 and Swift62 passed+5 skips remain green. Native shared-fixture first run exited65: default entry lost focus after an error shifted layout; largest-size save stayed pending and next-section failed. Captured hierarchy showed VALIDATION_FAILED. Direct request against :3000 proved its stale dev module rejected backup as an unknown field, while newly built :3100 accepted it. Restarted only the identified repository Next dev process, retained same :3000 LAN binding, then verified identical request returns200. No DB reset. Native unchanged-assertion rerun pending final result.


Native follow-up after local-server restart: the largest-text test passed, but default text still lost focus (runner exit65, `/tmp/shared-worksheet-ui-final.xcresult`). This exposed an additional app defect: ViewThatFits could switch from stacked to horizontal when shared MAKE text changed to Saving, recreating the active TextField. Replaced content-dependent layout switching with a stable branch based only on Dynamic Type size. Host Swift remains62 passed+5 skips. Final native rerun uses `/tmp/shared-worksheet-ui-stable.xcresult`, pending result. Do not attribute the default focus failure solely to the stale backend.


Final shared-stock native verification: **runner exit0 / TEST SUCCEEDED,2/2 UI tests** on iPhone17 Pro / iOS26.5 (default31.171s, largest46.215s). `/tmp/shared-worksheet-ui-stable.xcresult`, `/tmp/shared-native-ui-stable.log`; screenshots exported and visually inspected. Both enter display and one-time backup, save, keep PAR hidden and advance to salad; stable layout fixes focus without reducing text size or weakening assertions. Temporary credential fixture removed; generated Xcode project restored. Host Swift62 passed+5 skipped, DB24/24, HTTP5/5 with build, TypeScript137 and prior typecheck/lint pass; generated database types match. The final change after TypeScript checks is Swift layout only plus docs. Photo/vision untouched. Full108-row phone walkthrough, physical install and spoken accessibility remain unverified. Existing phone binary is not updated; local backend remains running on port3000.


### Owner-requested worksheet phone installation — 2026-10-04
Built current SwiftUI worksheet for physical La boo boo (iPhone16 Pro) with existing Apple Development team, bundle com.displayrefill.app, Debug build2. Xcode build exited0; devicectl in-place installation exited0 and confirmed the bundle installed. Existing app container/Keychain were not removed; no logout, reset, store/count edits or hosted operations. Verified bundled API http://172.20.10.3:3000 and Auth http://172.20.10.3:54321, with publishable configuration only. Mac-side LAN health checks passed. Used existing temporary Debug HTTP/privacy plist; source plist/Release unchanged.

Artifacts: `/tmp/display-refill-device/worksheet-install-build.log`, `worksheet-install.json`, `worksheet-launch.json`. Automatic launch failed specifically because the iPhone was locked (CoreDevice10002 / FBS Locked). Installation is complete; owner must unlock and open Display Refill. Login retention and full108-row physical workflow have not been verified after this install. This supersedes earlier notes that the phone binary was not updated.


### Stock Check and Shared Prep List — 2026-10-05
Owner authorized grouped preparation across displays, partial quantities, Done, shared staff progress and updated stock throughout the day. Implemented migrations23–27 locally, service-only prep/stock/restart RPCs and routes, Swift Stock Check/Prep List/quick product recount, persisted uncertain saves, five-second foreground refresh and the admin read-only prep monitor. Existing manager PAR setup/history preserved. No University Place counts were used as test fixtures or overwritten. No hosted operations, resets, commits, SIMON.md changes or new photo/provider work.

Actual evidence so far:
- npm run check: exit0;137 TypeScript unit tests (5+71+48+13), typecheck, lint, admin/worker build and configuration guards passed. Existing Edge Runtime process.exit warning remains. /tmp/prep-check-final.log
- Generated database types match applied local schema: /tmp/prep-types-final.log.
- Full API suite111/111 passed, freshly built server, logs retained: /tmp/prep-api-full.log. Targeted prep+worksheet13/13: /tmp/prep-api4.log.
- Full database suite166/166 passed without reset: /tmp/prep-db-final.log. No claim of from-empty migration verification.
- Latest host Swift run74 reported:69 passed and5 opt-in skips. /tmp/prep-swift-final2.log. Includes prep/stock retry persistence and a slow-read/write-order regression.
- Earlier native bundle /tmp/prep-native.xcresult passed4/4 before quick-stock/final changes. Final-code suite /tmp/prep-native-final.xcresult exited65:3 tests passed,2 failed with4 assertions. Partial prep/reopen did not reach expected remaining; quick-stock test checked a lazy list row before scrolling and switched tabs without waiting for the sheet dismissal. Captured output retained at /tmp/prep-native-final.log. Background polling shared the write busy flag; now separate read loading/generation prevents taps being disabled and stale reads overwriting newer saves. A unit test proves this race boundary. Test now waits for sheet dismissal and reaches the lazy row before asserting presence.
- The rerun at /tmp/prep-native-verified.xcresult failed all five tests before login because the local backend had stopped. The account screen reported an unreachable backend; this was not a workflow acceptance run. Restarted the backend and added API health/Auth/board preflight to a reproducible harness.
- Final harness `npm run test:ios:production`: actual process exit0, TEST SUCCEEDED,5/5 UI tests, zero failures: partial prep/reopen41.658s, largest-text Done49.598s, largest-text quick stock75.162s, default worksheet33.504s, largest worksheet43.187s. Evidence: /tmp/prep-native-harness-final.log and /var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-UTFNUy/results.xcresult (xcodebuild.log beside it). Credential fixture removed in finally; generated project restored. The focused suite does not rerun the older photo/history UI suites. A native invalid-frame warning occurred in largest worksheet despite passing assertions; cause remains uninvestigated.
- Manager browser: isolated synthetic admin, combined25-container row, category filter excludes fruit from Vegetables, five-second timestamps advancing,390px viewport with document scrollWidth390. Full screenshot visually inspected: /tmp/prep-web-full.png. Browser session closed. No PAR or owner-store mutations. Harness syntax and git diff --check pass.

Other captured failures: migration27 initially used create instead of create-or-replace for an existing helper, rolled back, and caused the following build to lack the generated RPC type. Corrected while unapplied; migration then applied and fresh build/API passed. One73-test host Swift run had four assertions fail in the existing interruptedPhotoSubmissionRestoresExactBodyKeysAndCrop test: /tmp/prep-swift-final.log. Unchanged isolated rerun1/1 and later full73/74 runs pass; cause remains unexplained. Keep this as an open intermittent finding rather than treating later passes as an explanation.

Still unverified: latest-feature physical install/workflow, two real phones on LAN, spoken VoiceOver/focus, web screen reader, real camera/provider, hosted operations, from-empty migration replay, realistic query volumes and offline business operation. Prep requires a connection to save and record quantities; interrupted writes can be retried. Five-second polling is not instantaneous delivery or automatic sales detection.


### Shared Prep List phone installation — 2026-10-05
Owner requested installation. La boo boo available/paired. Signed Debug build3 for com.displayrefill.app succeeded; corrected build installed in place and launched successfully, all command exits0. Bundled API http://172.20.10.3:3000, Auth http://172.20.10.3:54321 and nonblank resolved local public key verified without printing the key. Both LAN health endpoints passed. Initial build omitted the public key and was installed before the validation failure was handled; corrected build then replaced it before launch. No uninstall, logout, count/store edits, database reset, hosted operations or commits. Existing container/Keychain preserved by in-place installation; actual retained login and workflow have not been observed. Evidence: /tmp/display-refill-device/prep-install-build-configured.log, prep-install-configured.json, prep-launch.json. Phone workflow/spoken accessibility acceptance remains open. Local backend must remain running and reachable from the phone.


### Owner stock-entry simplification — 2026-10-05
Removed separate cooler inputs from section and quick-stock screens; employees enter HAVE only. TO MAKE is a read-only server-calculated shortage for that section, including shared products before another section finishes.250ms autosave; no client exposure of PAR or local calculation. Migration28 applied locally without reset; immutable historical counts/backup left unchanged. Legacy compatibility fields sent as0 by new app saves. No hosted changes or owner count mutations.
Initial host Swift run failed4 assertions in the now-superseded test requiring cooler entry. Replaced that requirement with a test proving HAVE alone, immediate shared-section shortage, and identical retry key/zero compatibility value. Updated quick-stock retry test to omit cooler input, and native tests to assert absent cooler controls and numeric3 before continuing. Final host Swift74 reported,69 passed+5 skips (/tmp/simple-stock-swift-final.log). Targeted stock/prep API13/13 passed, fresh built-server artifact reused (/tmp/simple-stock-api-targeted.log; server log captured). Typecheck/lint exit0; generated DB types match applied schema. Full API attempt (/tmp/simple-stock-api.log) stopped reporting after RUN, with no totals and the server/process later absent; cause unestablished. It is unverified, not counted as passing.
Native initial five-test run exited65:3 prep workflows passed;2 section tests failed only because their assertion expected "3" while the combined accessibility element says "TO MAKE, 3". Updated the exact assertion without changing app code; focused rerun exit0/TEST SUCCEEDED,2/2 default/largest section tests passed29.151s/36.492s. Negative assertions prove no cooler field and no After both sections message. Evidence: /var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-2FMbe9/results.xcresult (initial3-pass/2-fail) and production-prep-ui-nNFeCB/results.xcresult (final2/2); /tmp/simple-stock-section-ui.log. These are5 passing workflows across two runs, not one passing five-test run. Harness supports PRODUCTION_TEST_SUITE for focused reruns; default retains both suites.
Signed Debug build4 succeeded; resolved public Auth key and LAN URLs verified. Installed in place and launched on La boo boo, both exits0. /tmp/display-refill-device/simple-stock-build.log, simple-stock-install.json, simple-stock-launch.json. Existing container/Keychain retained; owner login/workflow not observed. No uninstall, logout, real stock edits, hosted operations or commits. Physical/spoken accessibility acceptance remains unverified.


### M1 BUNKER (FRUIT) owner list — 2026-10-05
Owner supplied seven ordered fruit names with PAR5 each. Existing local University Place catalog already had these seven identities/order; five PAR10 values changed to5, two existing5 unchanged. Audited production_mutate configure calls in one transaction using a temporary store-manager importer; memberships revoked before commit and Auth identity banned after commit. No permanent roles elevated. No counts or historical snapshots changed; supplied HAVE examples not imported. Receipt context/pilot/morning-item-list/m1-update-receipt.json. Original import receipt retained as historical evidence. Current JSON/manager CSV reconciled; employee worksheet removes superseded cooler wording. Section label M1 BUNKER (FRUIT) used in iOS/web and UI selectors.
Verified employee password Auth plus actual local config API: seven exact names in supplied order, PAR absent and can_manage=false. Temporary read-only Auth session signed out locally; phone session untouched. Host Swift74 reported/69 passed+5 skips (/tmp/m1-swift.log). No new full simulator/browser suite for this label/catalog-only change.
Phone build5 initially failed twice with internal Code Signing subsystem error. Fresh directory diagnostic failed explicitly with No space left on device; df showed116MB free. Removed only three temporary generated caches (/tmp/feature07-ios-derived, the os.tmpdir feature07-ios-derived, and failed m1-derived), preserving source, app data, logs and result bundles;626MB free afterward. Original signing settings then built successfully (/tmp/display-refill-device/m1-build-after-cleanup.log). Initial signing error cause not independently established. No source signing settings changed.
Verified build5 resolved public Auth key and LAN API URL; in-place install and launch on La boo boo exit0 (/tmp/display-refill-device/m1-install.json, m1-launch.json). Actual owner seven-row phone walkthrough not observed. Existing drafts retain their original PAR; a fresh count uses new5 values. No hosted operations, resets, SIMON.md changes or commits. git diff --check clean after normalizing CSV newlines.


### SALAD DESTINATION and 6FT FRUIT categories — 2026-10-05
Owner supplied salad/fruit table and confirmed slices, quarters and both60oz containers belong to Party tray. Retained9 salad identities/PARs; moved SOUTHWEST before the final BLT (PAR2). Fruit51 identities/PARs unchanged; configured Top row12,2 for6 eleven,$5 bowls14,$10 bowls7,Party tray7. Changes use audited production_mutate configure in one local transaction with a temporary manager importer, retired/banned afterward; permanent roles unchanged. Historical counts/snapshots preserved, HAVE examples not imported. Receipt context/pilot/morning-item-list/fruit-salad-update-receipt.json. Current JSON/CSV/checklist reconciled.
UI section labels SALAD DESTINATION and6FT FRUIT; fruit headings use pinned category/order and keyboard Next crosses groups. Opening a new section now resets scroll position using stable check identity; autosaves retain identity/focus. Existing drafts need a fresh count to get new categories.
Evidence: actual employee Auth/config API verifies9 ordered salad items and51 ordered categorized fruit items, no PAR and can_manage=false. Host Swift74 reported/69 passed+5 skips, /tmp/fruit-groups-swift-final.log. Lint exit0, /tmp/fruit-groups-lint.log. No schema/migration changes; no full API/DB suite rerun for catalog/UI-only changes.
Native progression retained: GwiWLU run compiled before the helper returned to the first heading; stopped its xcodebuild intentionally (harness exit1) to rerun corrected helper. JmRNgh run exit65: default/largest worksheets passed, fruit test failed first-field reachability while its category/keyboard assertions passed. Identified retained scroll offset from clicking the third section; reset the ScrollView per new count. Final of7ysh run actual harness exit0/TEST SUCCEEDED:3/3, zero failures (default29.512s, grouped fruit/Next at largest66.506s, largest worksheet38.875s). /tmp/fruit-groups-ui-scroll-fixed.log and /var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-of7ysh/results.xcresult. A10 invalid-frame warnings remain logged; not claimed fixed. Five-category fixture is synthetic; full owner51-row phone walkthrough not observed.
Signed build6 with final scroll fix exit0; bundled local public key/API URL verified. In-place phone install and launch both exit0: /tmp/display-refill-device/fruit-groups-build-final.log, fruit-groups-install.json, fruit-groups-launch.json. Existing app container/Keychain retained. No logout, owner count edits, resets, hosted operations, SIMON.md edits or commits. Test credential fixture removed. Temporary generated simulator derived cache removed after verification to recover space; logs/result bundles retained. Physical spoken accessibility and actual owner workflow remain unverified.


### 2026-10-05 — Phone sample-store assignment corrected

The retained physical-phone employee account was assigned both SIM / Simulator Store and FM-615 / University Place. The remembered sample store explained the abbreviated sample catalog. Revoked only that account’s local SIM membership in a transaction, incremented its revision, and recorded `membership.revoked` with the local operator reason. No stores, products, counts, sessions, or history were deleted. Fresh authenticated `/api/v1/me` now returns only FM-615 University Place. Authenticated production config returns all 108 active items: M1 fruit 7, salad 9, 6FT fruit 51, veggie 41. Fruit groups are Top row 12, 2 for 6 11, $5 bowls 14, $10 bowls 7, Party tray 7. No product names contain synthetic. This is an assignment correction, with no app code change or new build. The already-running phone must reopen the app to reload account/store selection; the physical screen after reload remains unverified. All operations local; no hosted changes.


### 2026-10-05 — Screenshot simulator account corrected and visually verified

User screenshots were from Device Hub / iPhone 17 Pro simulator, signed into production-simulator-2cdcf108-cd8a-4c55-89da-88b1e7a9aafa@example.com, not the retained physical-phone employee. The earlier assignment correction therefore did not fix that screen. Through Device Hub UI, signed out the test account and signed into the existing University Place employee account. Verified University Place store text and all seven M1 HAVE inputs, nine salad HAVE inputs, fruit case actual Top row and 2 for 6 items, $5 bowls, $10 bowls and Party tray including LARGE TRAY W/ DIP at bottom. No stock values were entered or production recorded. Opening sections created/reopened blank draft checks only. Left simulator at University Place section selection. No code/build change, no hosted operations, no sample fixture deletion. Physical phone screen remains separately unverified.


### 2026-10-05 — Compact employee UI iteration

Reduced Stock Check vertical spacing and card padding; compact inline navigation title; store number/name; shorter section statuses; removed repeated instructions and always-visible missing-configuration advice. Product rows retain HAVE entry and backend TO MAKE, minimum 44pt input height, numeric keyboard/Next and accessibility-size stacked layout. Added counted progress and shorter visible save status while retaining its descriptive accessibility label. Moved fresh-count action into More, retaining the confirmation. Prep List now collapses counting guidance and shortens refresh text; error/conflict/partial-total warnings remain. Changed the existing Prep UI test locator to the renamed Quick stock update action; its suite was not rerun.

Evidence: signed physical-device build 7 succeeded (`/tmp/display-refill-device/compact-ui-build.log`), installation and launch exited 0 (`compact-ui-install.json`, `compact-ui-launch.json`). Host Swift tests: 74 reported, 69 passed / 5 existing opt-in skips (`/tmp/compact-ui-swift.log`). Focused simulator suite: exit 0, TEST SUCCEEDED, 3/3 passed (default 34.771s; largest-text categories/Next 61.526s; largest worksheet 41.587s). Bundle `/var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-dKiNv4/results.xcresult`; harness log `/tmp/compact-stock-ui-tests.log`. Native UI tests use an isolated local sample organization. Restored simulator to the existing University Place employee afterward; visually verified compact M1 rows and actual seven inputs, and loaded Prep List with collapsed help and actual products. Opened a blank M1 recheck draft but entered no stock values or preparation. No backend/schema/PAR changes by this task. Spoken VoiceOver, device workflow, and a complete Prep UI rerun remain unverified. No hosted operations, SIMON.md edits or commits.


### 2026-10-05 — Top-bar back navigation, retained quick counts and Prep filters

Stock Check draft editor now has a leading Sections/back action; it saves pending edits before returning and stays put on save failure/conflict. Removed the duplicate bottom back action. Quick stock editor seeds only missing input keys from last saved location HAVE values, retaining zero, unknown blanks, edits and pending retry payloads. Seeding does not write counts; saving remains explicit and revision checked. Prep List total moves to the top bar; category/type/sort/completed controls are consolidated into a Filters sheet with reset and Done. Store/update/help are in Prep details; per-product made/time/activity are inside the existing disclosure; Done has shorter visible wording with the descriptive accessibility label retained. No calculation/schema/PAR changes.

Verification: final host Swift report 76 tests, 71 passed and 5 existing opt-in skips (`/tmp/topbar-ui-swift-complete.log`), including two new regressions for seeded counts/edit preservation and pending retry protection. First combined native UI run exited 65: 5/6 passed. `testLargestPrepDone` failed because the completed-filter tap did not turn it on; missing completed rows caused subsequent failures. Preserved bundle `/var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-43W3UR/results.xcresult` and `/tmp/topbar-ui-tests.log`. Gave the switch a dedicated labels-hidden control alongside its visible caption, and strengthened the test to assert on-state. Corrected Prep rerun exited 0, TEST SUCCEEDED, 3/3 passed: partial/reopen 55.557s, largest Done/filter 52.332s, largest quick-stock/reopen 92.540s. Bundle `/var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-pnYmrm/results.xcresult`; `/tmp/topbar-ui-prep-corrected.log`. All three unchanged Stock Check UI tests passed in the first run (48.144s / 91.592s / 64.021s); six workflows have passing evidence across these two runs, not one passing combined run.

Signed device build 9, install and launch succeeded: `/tmp/display-refill-device/topbar-ui-build-final.log`, `topbar-ui-install-final.json`, `topbar-ui-launch-final.json`. Restored simulator to University Place after tests. Visually verified top back chevron on actual M1 and actual Prep List with top-bar total/filter and compact rows. User changed simulator view during the manual back-button action, so stopped interacting; manual return-action check remains unverified separately. No real stock/prep values entered by this task. Spoken VoiceOver, physical-device workflow and full accessibility audit remain unverified. All test backend operations local/sample only; no hosted changes, SIMON.md edits or commits.

## 2026-10-05 — Compact Prep rows and offline Build Book (build 11)

Implemented this requested presentation update. Prep shows the remaining number beside the product name, with a short Made field followed by Record and Done at standard sizes. Accessibility text sizes use a stacked layout. Location details use consistent M/D labels on separate lines. Default sorting is Fruit ($5 bowls first, then $10 and other fruit categories), Vegetables, Salads; the Filters sheet also supports group/category/type, quantity/name sorting and completed items. Existing backend calculations, revision/idempotency protections and stock/prep events were not changed.

Added a fifth bottom tab, Build Book, bundling the user's original May 21 PDF offline. Product/ingredient text search, category filtering, original PDF navigation, selectable page text, full-book access and load/error states are available. 326 physical pages form 195 entries; the bundled PDF SHA-256 matches the source. Source heading discrepancies and ten textless pages are preserved, and stocking products are not automatically mapped to recipes. Details: `context/pilot/build-book.md` and `build-book-import.json`.

Evidence:

- Full host Swift run: exit 0, 79 reported tests = 74 passed plus five existing opt-in skips, `/tmp/build-book-swift-final.log`.
- Final focused BuildBookTests: 3/3 passed; source coverage, product/ingredient search/category filtering and Prep ordering. `/tmp/build-book-position-swift.log`. Compiles the final UI implementation on macOS.
- Native Prep suite: exit 0, 3/3 passed (partial prep/reopen 33.076s, largest-text Done 32.785s, largest-text quick-stock 60.909s). Bundle `/var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-1OFYmy/results.xcresult`, harness `/tmp/build-book-prep-ui.log`.
- Initial Build Book smoke: bundle summary 1/1 passed, `/var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-YiHLJT/results.xcresult`. Its assertion checked PDF presence and extracted ingredients but did not verify initial PDF page position. Subsequent visual inspection found PDFKit opened at the cover. This was a real UI defect despite the passing smoke test.
- Fixed positioning after layout; strengthened test requires original PDF's `10oz` ingredient text before opening Page text. Final native Build Book test passed 1/1 (31.720s), exit 0, TEST SUCCEEDED; `/var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-ez6Enp/results.xcresult`, `/tmp/build-book-reader-position-ui.log`.
- CUA visual inspection on the simulator with the actual FM-615 account verified compact rows, $5 bowls first, the Build Book tab and original Watermelon ingredient/build pages. No actual stock/prep values were edited during inspection. Temporary test login was replaced with the existing FM-615 account after the final test.
- Signed physical iPhone build 11: build/install/launch exit 0. Evidence `/tmp/display-refill-device/build-book-final-build.log`, `build-book-final-install.json`, `build-book-final-launch.json`; artifact CFBundleVersion verified as 11. Build 10 was superseded because of the PDF positioning fix.

Limits: native book test covers one representative recipe; every recipe's text/order has not been manually checked. No OCR was added for textless pages. Book screen at largest Dynamic Type, spoken VoiceOver, pinch zoom and the full physical-phone workflow remain unverified. The final focused Swift checks and Book UI check followed the PDF-only positioning fix; Prep UI was not unnecessarily rerun. Backend/web suites were not rerun for this Swift/resource-only change. Existing A06/accessibility/camera/real-provider/pilot gaps remain open. No hosted operations, source PDF edits, commits or SIMON.md changes.

## 2026-10-05 — Prep alignment follow-up (build 12)

Made now fills the available row width beside Record/Done; the buttons retain their natural width. Locations in the disclosure are combined into one summary, e.g. `M1 Bunker: 5 · D 6ft Fruit: 20`, instead of separate location rows. Summary text can wrap at accessibility sizes rather than clip. Product grouping, counts, recent preparation events and backend calculations are unchanged.

Verified: macOS Swift package build exit 0 (`/tmp/prep-alignment-swift.log`), signed iPhone build/install/launch exit 0 (`/tmp/display-refill-device/prep-alignment-build.log`, `prep-alignment-install.json`, `prep-alignment-launch.json`). Installed build 12. This small presentation change did not rerun simulator workflows or backend tests; on-phone layout and spoken VoiceOver remain unverified. No hosted changes, commits or SIMON.md edits.

## 2026-10-05 — Justified Prep locations (build 13)

The location disclosure now uses an HStack with flexible space between location labels, placing M1 Bunker and D 6ft Fruit at opposite ends instead of joining them with a separator. Text may wrap at accessibility sizes. Swift package build and signed phone build/install/launch passed (exit 0): `/tmp/prep-justified-swift.log` and `/tmp/display-refill-device/prep-justified-{build.log,install.json,launch.json}`. Simulator workflows and on-phone visual/accessibility inspection were not rerun for this presentation-only adjustment. Counts and backend behavior unchanged; no hosted changes or commits.


## 2026-10-05 — Waste Log and made/waste reporting

Implemented the requested local workflow: M. M1 Bunker and D. 6ft Fruit labels retain justified alignment; Waste Log replaces the Saved checks tab without deleting history or cached checks. Employees record discarded sellable containers by product, date, quantity, reason and optional note; entries include staff/time. Undo appends a reversal, preserving the original. Home shows today's made/wasted totals; iOS and web reports support day, Sunday-based week and calendar month in the store timezone. Dashboard sorting supports most made/most wasted. Sales are deliberately deferred per the owner's answer; made minus waste is not represented as sales. Waste does not automatically change HAVE or preparation quantities; staff update Stock Check after discarding stock.

Migration 29 applied with local db push only, without reset. Server-only RPCs enforce fresh memberships, store isolation, quantity validation, concurrency/idempotency and append-only records. Generated database types updated. Scope and contracts: feature-specs/14-waste-and-made-reporting.md, api-contracts.md and data-model.md.

Evidence:
- npm run check exit 0: 137 TypeScript unit tests, typecheck, lint, builds and configuration/security guards; /tmp/waste-check-final.log. Existing nonfatal Edge Runtime/Turbopack warning remains. Initial lint failure was fixed before this final run.
- Full database suite 172/172 exit 0, /tmp/waste-db-regression.log; new targeted suite 6/6, /tmp/waste-db-targeted.log. No fresh-empty rebuild claimed.
- Full HTTP suite 116/116 exit 0 against a freshly built local server with logs captured; /tmp/waste-api-regression.log. A06 remains unexplained/open.
- Full host Swift suite 82 reported: 77 passed, five existing opt-in skips; /tmp/waste-swift-release.log. Final day-selection stale-report fix followed by focused model tests 3/3, /tmp/waste-model-final.log.
- Native Waste suite 2/2, harness exit 0 / TEST SUCCEEDED: default and largest text, record/search, home totals, relaunch and undo. /tmp/waste-native-ui-ready.log; result bundle /var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-HlLznE/results.xcresult. Earlier runs exited 65: test helper shadowed XCTest add (compile failure), then largest test tapped Add before catalog was ready. Fixed helper and explicit enabled-state wait; no app assertions removed. Logs /tmp/waste-native-ui.log and /tmp/waste-native-ui-corrected.log preserved.
- Native Prep regression 3/3, exit 0 / TEST SUCCEEDED: partial/reopen, largest Done, largest retained quick-stock counts. /tmp/waste-prep-regression-ui.log; result bundle /var/folders/cl/m5zp9zp57bb6dmqg46ns9dnh0000gn/T/production-prep-ui-Zh6zOr/results.xcresult. Legacy manual workflow adapter now reopens via History; that full suite was compiled but not rerun.
- Browser read-only check verified dashboard loading/empty states and week filter in an isolated fixture. Positive report values are covered by API/database tests, not claimed browser verified.
- Simulator restored from test account to existing FM-615 University Place employee. Home visibly shows actual sections and made/waste totals; no actual stock/preparation/waste entries changed during inspection.

Physical installation pending: attempted signed build 14 exited 70 because Xcode cannot find paired phone La boo boo (destination unavailable). /tmp/display-refill-device/waste-release-build.log. No installation occurred; existing phone build/data/login preserved. Requested reconnect/unlock. Physical Waste workflow and spoken VoiceOver remain unverified, along with existing camera/real-provider/pilot gaps. No hosted operations, commits, SIMON.md edits or production schedules.

## 2026-10-05 — Hosted staging and TestFlight plan

Owner wants to test on a different iPhone at a different store, away from the Mac. Confirmed that local LAN testing is not enough for that use case; the next path is hosted staging plus TestFlight. Added `context/pilot/staging-testflight.md` and linked it from `context/README.md`.

The plan keeps the first remote pilot manual-only: Stock Check, Prep List, Build Book, Waste Log and made/waste reporting. Photo analysis remains disabled until provider/data-policy/benchmark decisions are approved. The runbook lists required private values, Supabase Auth settings, admin/API environment variables, TestFlight build configuration, first remote-store script and acceptance gates.

No hosted Supabase project was created or modified, no admin/API deployment was run, no TestFlight archive was uploaded, no worker schedule was installed, no real provider credentials were configured, no commits or SIMON.md edits were made.

Follow-up account check after owner logged in: Supabase CLI is authenticated and can see hosted project `Supreme-produce` (`immmuxzarcwjwlrfspwj`), linked from this checkout. Remote migration list shows local migrations through `20261005002900`, local `20261005200208_restore_shared_production_read.sql`, and one remote-only migration timestamp `20261005195823` that is not present in the repo and must be identified before trusting staging. Supabase project API keys are retrievable; do not paste them into chat or commit them. Vercel CLI is not logged in locally and no `.vercel` project link exists in the repo. The Vercel connector reports no teams in its visible scope. App Store Connect upload authentication is still missing for CLI upload: `xcrun altool --list-providers` reports that JWT or username/app-password authentication is required. Xcode local signing may still work separately, but TestFlight upload is not yet verified.

Owner then logged in with `npx vercel login`. Vercel CLI user is `sawsimonlinn`; visible team is `simon's projects` on Hobby plan. Created/linked Vercel project `display-refill-admin` (`prj_pMSuKnjkADsPisTYvCpMv3FT0dmu`) connected to GitHub repository `SawSimonLinn/display-refill`; `.vercel` is gitignored. Updated Vercel project settings to `rootDirectory=apps/admin`, `framework=nextjs`, `nodeVersion=22.x`. Vercel env vars are still empty. An attempted automated env setup was rejected by automatic approval review because it would persist a Supabase service secret into Vercel's production environment; no env vars were written. Use the Vercel dashboard or an explicit reviewed approval path to set staging/production env values.

After owner added env vars in Vercel dashboard, first production deployment was created with `npx vercel deploy --prod --yes`. Deployment succeeded: `dpl_5WYYAYjaMotWk6UdGT48tB59z7Rq`, production alias `https://display-refill-admin.vercel.app`, inspect URL `https://vercel.com/simons-projects-61dc1d25/display-refill-admin/5WYYAYjaMotWk6UdGT48tB59z7Rq`. Build used `apps/admin`, Next.js 16.3.8 and Node 22; the existing nonfatal Edge Runtime warning for `process.exit` in instrumentation remains. Health verification through `npx vercel curl https://display-refill-admin.vercel.app/api/v1/health` returned status ok and configuration ok (`request_id=9cbaaef4-ad1a-400f-b31b-3fc0c4b7a76a`). Deployment has Vercel Authentication protection enabled; browser/API access for ordinary users and the iOS app are not yet verified. The first upload sent about 649.7 MB / 6481 files, so deployment ignore settings should be tightened before repeated deploys.

Owner saw hosted app redirect to `http://localhost:3000/sign-in?error=request`. Verified Vercel production env had `APP_ORIGIN="http://localhost:3000"`. Removed production target for `APP_ORIGIN`, re-added production value `https://display-refill-admin.vercel.app`, and redeployed. New deployment `dpl_88FPy28afX63jtoEUTFunEbbzyuN` is ready and aliased to `https://display-refill-admin.vercel.app`. Verification through `npx vercel curl -I`: `/sign-in` returns HTTP 200 with no localhost redirect, `/api/v1/health` returns HTTP 200. Vercel Authentication protection remains enabled, so ordinary remote iPhone/API access is still a separate gate.

On 2026-10-06, owner confirmed hosted admin login works after creating a fake hosted Supabase admin manually and bootstrapping membership directly. Hosted API is publicly reachable from normal curl: `curl -I -L https://display-refill-admin.vercel.app/api/v1/health` returned HTTP 200, so Vercel Authentication is not blocking the health route for ordinary clients at that time. Wrote gitignored `apps/ios/DisplayRefill/Config/Local.xcconfig` with hosted staging public values: API `https://display-refill-admin.vercel.app`, Supabase `https://immmuxzarcwjwlrfspwj.supabase.co`, and hosted publishable key. Simulator Debug build with hosted staging config succeeded on iPhone 17 Pro (`C5F3DEA0-0C84-4ED2-84D8-60D0933463CC`): `xcodebuild ... build` exit 0 / `** BUILD SUCCEEDED **`. Physical phone `La boo boo` is unavailable over USB. App Store Connect/TestFlight upload remains unauthenticated by CLI (`altool --list-providers` still requires JWT or app password). Hosted iOS login/workflow not yet run; TestFlight archive/upload not yet performed.

Owner reported TestFlight validation failure for missing 120x120 iPhone icon and missing `CFBundleIconName`. Added `DisplayRefill/Resources/Assets.xcassets/AppIcon.appiconset` with required iPhone icon PNG sizes plus iOS marketing icon, set `CFBundleIconName=AppIcon`, and updated `apps/ios/project.yml` to include `DisplayRefill/Resources` in the app target. Regenerated the Xcode project and archived locally with hosted staging config: `/tmp/DisplayRefill-IconCheck.xcarchive` archive exit 0. Verified bundle identifier `com.displayrefill.app`, `CFBundleIconName=AppIcon`, `Assets.car`, and `AppIcon60x60@2x.png` (120x120) are present in the archived app. Upload/TestFlight validation after this fix has not yet been observed.

Owner installed TestFlight build and saw "App not configured": `API_BASE_URL must be an http:// or https:// URL` and `SUPABASE_URL must be an http:// or https:// URL`. The TestFlight build came from committed/shared config, not the local ignored `Local.xcconfig`. Put hosted staging public values into committed app configuration. Initial archive checks showed `xcconfig` slash parsing still reduced URLs to `https:`, so the hosted public values were written directly into `DisplayRefill/Resources/Info.plist` for this staging build. Archive `/tmp/DisplayRefill-HostedConfig3.xcarchive` exit 0 verified `API_BASE_URL=https://display-refill-admin.vercel.app`, `SUPABASE_URL=https://immmuxzarcwjwlrfspwj.supabase.co`, publishable key present, `CFBundleIconName=AppIcon`, and `ITSAppUsesNonExemptEncryption=false`. A new TestFlight upload from this updated project is required; the broken installed build will not self-update until TestFlight receives the new archive.
