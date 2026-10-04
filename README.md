# Display Refill

Display Case Refill Scanner: employees check a store display against its
planogram (POG) and get a refill list. SwiftUI app for employees, Next.js
admin dashboard and API, Supabase Auth/Postgres/Storage, and a persistent
TypeScript worker for photo analysis.

**Status: features 01–05 (foundation, database and security, Supabase Auth
and memberships, store/display/product management, POG builder/publication).** Sign-in, sessions,
membership management, stores, products, POG identities and displays (with
published-version assignment), private reference-image validation and the POG
editor/publication work against the local stack; employee scans and vision are
not built yet. See
[context/progress-tracker.md](context/progress-tracker.md) for what is verified.
Specifications live in [context/](context/README.md).

## Layout

```text
apps/admin/              Next.js 16 App Router: admin UI + /api/v1 route handlers
apps/ios/                SwiftUI app (XcodeGen spec) + DisplayRefillKit Swift package
packages/domain/         Pure contracts: envelopes, error codes, vision schema, fixtures
packages/server/         Server-only: config validation, logger, HTTP helpers, vision adapters
workers/scan-worker/     Persistent worker: claims durable Postgres jobs, deterministic mock vision only
supabase/                Migrations, seed and local config (see supabase/README.md)
tests/db/                Database integration tests (local Supabase only)
tests/api/               Black-box HTTP tests of the admin app + /api/v1 (local only)
scripts/                 Repository checks, API test runner, first-admin bootstrap
context/                 Specifications
```

npm workspaces; one lockfile at the root. Workspace packages are consumed as
TypeScript source (Turbopack transpiles them for the admin app; esbuild
bundles them into the worker).

## Toolchain

Versions recorded on the feature 01 machine (macOS 26, Apple Silicon):

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22.13.1 | `.nvmrc`; `engines` requires 22.13+ (<23) |
| npm | 11.18.0 | `packageManager` field |
| Next.js / React | 16.3.8 / 19.2.8 | Turbopack build |
| TypeScript | 5.9.3 | strict, `noUncheckedIndexedAccess` |
| Zod | 4.6.5 | runtime validation |
| Vitest | 5.0.3 | TS unit tests |
| ESLint | 9.39.5 | `eslint-config-next` 16.3.8 |
| Tailwind CSS | 4.3.3 | semantic tokens in `apps/admin/src/app/globals.css` |
| esbuild / tsx | 0.28.2 / 4.23.15 | worker build / dev |
| Swift | 6.4 (Xcode 27.0; legacy CLT 6.2.3 remains, see E02) | Swift 6 language mode |
| Xcode | 27.0 (27A266a), iOS SDK 27.0 | app build, Swift package tests and XCUITest on the iPhone 17 Pro simulator (iOS 26.5); see apps/ios/README.md. No physical-device build has been run |
| Supabase CLI | 2.119.0 | root devDependency (`npx supabase`) |
| Postgres (local) | 17 (`supabase/postgres:17.11.0.002`) | via `supabase start` |
| supabase-js / pg | 2.117.2 / 8.23.1 | server package, admin app, database tests |
| @supabase/ssr | 0.12.7 | web session cookies |
| Colima / Docker CLI | 0.10.3 / 29.8.2 | container runtime used for local Supabase |

All npm dependencies are pinned to exact versions.

## Commands

```bash
npm install                 # once, at the repo root
npm run typecheck           # all workspaces
npm run lint                # admin app (ESLint)
npm test                    # all workspaces (Vitest)
npm run build               # admin (next build) + worker (esbuild bundle)
npm run check:client-config # after build: no server secrets in browser bundle or iOS config
npm run check:db-scripts    # no script targets a hosted database
npm run check               # all of the above in order

# Database and API (needs local Supabase running: npm run db:start)
npm run test:db             # DB/RLS/function tests
npm run test:api            # builds the admin app, starts it on :3100 against local
                            # Supabase, runs tests/api (sign-in, refresh, logout,
                            # members, invite/reset emails via Mailpit), stops it
npm run check:db            # reset from empty + types check + test:db + test:api

# Operator only: first admin of an organization (context/operations-runbook.md)
node scripts/bootstrap-admin.mjs --email owner@example.com --org-name "Org"
```

Each part also builds alone:

```bash
npm run build -w @display-refill/admin
npm run build -w @display-refill/scan-worker
```

iOS: see [apps/ios/README.md](apps/ios/README.md).

## Running locally

### Admin/API

```bash
cp apps/admin/.env.example apps/admin/.env.local   # fill in values
npm run dev:admin                                  # http://localhost:3000
curl -i http://localhost:3000/api/v1/health
```

Use the values from `npx supabase status` (local stack). Invite and reset
emails go to Mailpit at http://127.0.0.1:54324. To sign in, bootstrap an admin
(command above, `APP_ORIGIN=http://localhost:3000`), open the invitation in
Mailpit and choose a password.

With incomplete configuration the server still starts, logs which variables
are missing or malformed (names and rules, never values), and API routes
answer `503 CONFIGURATION_INVALID`.

### Worker

```bash
cp workers/scan-worker/.env.example workers/scan-worker/.env   # fill in values
npm run dev:worker                                             # watch mode
npm run build:worker && npm run smoke -w @display-refill/scan-worker   # one-shot self-check
```

Invalid configuration exits with code 78 and a message listing each variable.
`SIGINT`/`SIGTERM` stop claiming and wait for in-flight attempts (bounded by the
45-second provider deadline). `VISION_MOCK_SCENARIO` selects a deterministic
mock outcome (`mixed`, `good`, `review`, `poor_alignment`, `occluded`, `invalid`,
`duplicate_ids`, `unknown_id`, `missing_slot`); no real provider is available.

## What is real and what is mocked

| Area | State |
| --- | --- |
| `GET /api/v1/health` | Real. Reports `database: not_checked`, `authentication: not_checked`, `job_queue: not_checked` (the queue exists; health does not probe it). |
| `/api/v1/me`, `/members`, `/members/invite`, `/members/:user_id`, `/auth/password-reset` | Real (feature 03). |
| `/api/v1/stores`, `/stores/:id`, `/stores/:id/displays`, `/displays/:id`, `/products`, `/products/:id`, `/pogs`, `/pogs/:id` | Real (feature 04; context/api-contracts.md). Other `/api/v1/*` paths return the JSON `404` envelope. |
| Configuration validation | Real, for admin and worker. |
| Web sign-in, reset, invite acceptance, sign-out | Real (Supabase Auth, httpOnly SSR cookies). Pages require a verified session; employees are sent to the iOS app. |
| Admin pages | Overview, Members, Stores, Displays, Products and POGs (reference-image/rectangle editor, immutable publication and cloning) are real. Scans (Feature 11) is real: filtered, paginated history of the stores a manager reviews (organization for admins) and per-scan review records with estimates, corrections, confirmation, completion attestation and retained/removed photo. |
| iOS app | Real against the local backend and verified in the iOS simulator: sign-in, Keychain session, store/display list, manual check (07), photo import/crop/upload (08), analysis polling/retry (09), estimate review, corrections and takeover (10). History tab (11) pages server history of assigned stores and opens review records; Saved checks still hold scan IDs only. Not verified: spoken VoiceOver, physical device, real camera capture. |
| Vision analysis | Feature 09 pipeline is real (validation, normalization, review routing, attempt evidence); the only adapter is the deterministic `MockVisionAdapter`, whose results are labeled synthetic in the app. No real provider is selected and no network call is made. Feature 10 iOS estimate review/correction and takeover are real against this mock output. |
| Database | Real (local): schema, RLS, triggers, private buckets, `publish_pog_version`, `create_scan`. See supabase/README.md. |
| Job queue | Real (feature 09): leases, heartbeats, per-store limit, retry budget, fenced results, explicit retry and manual takeover. See context/scan-lifecycle.md. |

## Conventions

- JSON keys are snake_case everywhere (`packages/domain/src/json.ts`);
  Swift uses explicit `CodingKeys`.
- Responses: `{ "data": …, "request_id": … }` or
  `{ "error": { "code", "message", "field_errors" }, "request_id": … }`,
  always `Cache-Control: no-store`, with an `x-request-id` header.
- Counts are integers 0–999; `null` means unknown and is never zero.
- Server secrets live only in `packages/server` consumers. Browser code reads
  only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
  the iOS app only `API_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
  Both reject a secret/service-role key placed in the publishable slot.

Feature 12 adds explicit local operations commands (from `workers/scan-worker`):
`npm run start -- --metrics` and `npm run start -- --cleanup` after building.
Cleanup deletes private images in bounded durable batches and preserves records;
90-day image / 365-day metadata durations remain proposals, and metadata deletion
is not implemented. No destructive schedule is installed. Shared auth limits and
the operator vision switch live in Postgres. Startup, scheduling, deployment,
rollback and backup/restore procedures and outstanding owner decisions are in
[the operations runbook](context/operations-runbook.md). Staging/production and
real-provider recovery have not been verified.


### Daily production worksheet
The employee Today tab now uses four sections (fruit mobile, salad mobile, fruit case, veggie case). Enter HAVE including display and prepared backup stock; the server calculates MAKE. PAR is configured by assigned managers or admins at `/production` → PAR setup using existing catalog products. Each product belongs to one section. Today's list uses only the latest finished check per section; unfinished coverage is marked partial. Existing scans/history are retained and photo work is deferred.

Apply additive local migrations18–20 without resetting retained test accounts. Follow `context/feature-specs/14-production-worksheet.md` and the progress tracker for exact setup, API semantics and test limits. A rebuilt app must be installed to see this change on a physical phone; source/simulator verification does not update the installed phone app.
