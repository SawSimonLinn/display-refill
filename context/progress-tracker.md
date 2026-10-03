# Progress Tracker

## Current Phase
Phase 0 — Foundation. Feature 02 complete on local Supabase (acceptance criteria demonstrated; not applied to any hosted project). Feature 01 implemented; its iOS build is still unverified.

## Current Goal
Feature 03 (Supabase Auth sign-in, sessions, membership management) on both clients. Deliver a complete manual refill workflow before live vision integration.

## Completed
- Reworked the seven uploaded reference documents for this project.
- Defined data, API, authorization, scan state, vision, refill and retention contracts.
- Added incremental feature specifications and pilot acceptance criteria.
- Prepared a documentation index, examples and ZIP delivery.
- Feature 01 repository foundation (details and evidence below).
- Feature 02 database, constraints and security (details and evidence below).

## In Progress
None.

## Feature Status
| Feature | Status | Evidence |
| --- | --- | --- |
| 01 Foundation | Implemented; iOS build unverified | TS checks pass (below); Swift compiled for macOS only |
| 02 Database and security | Complete (local) | 88/88 DB tests on a from-empty instance, acceptance audit, lint fixed (below) |
| 03 Supabase Auth | Not started | Auth specification only |
| 04 Store/display/product management | Not started | Feature spec only |
| 05 POG builder | Not started | Feature spec only |
| 06 Refill engine | Not started | Rules and test fixtures only |
| 07 Manual iOS workflow | Not started | Feature spec only |
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

## Next Up
Feature 03: Supabase Auth on web (SSR cookies) and iOS (bearer tokens, Keychain refresh), operator bootstrap for the first admin, membership management through the API. Install Xcode before iOS sign-in work to close the feature 01 iOS build gap.

## Open Questions
See decision-log.md for provider, hosting, device minimum, retention, training eligibility and real POG data. No question blocks feature 03.

## Session Notes
Documentation checks are not application tests. Do not copy the reference project's completion claims, package versions, screenshots or authentication state into this project. This project directory is not its own git repository: the enclosing repository root is the user's home directory, so no commits were made.
