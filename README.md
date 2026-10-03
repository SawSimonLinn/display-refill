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
workers/scan-worker/     Persistent worker process (mock vision; no job queue yet)
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
| Swift | 6.2.3 (Command Line Tools) | Swift 6 language mode |
| Xcode | **not installed** | needed for the iOS build; see apps/ios/README.md |
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
`SIGINT`/`SIGTERM` stop the worker cleanly.

## What is real and what is mocked

| Area | State |
| --- | --- |
| `GET /api/v1/health` | Real. Reports `database: not_checked`, `authentication: not_checked`, `job_queue: not_implemented`. |
| `/api/v1/me`, `/members`, `/members/invite`, `/members/:user_id`, `/auth/password-reset` | Real (feature 03). |
| `/api/v1/stores`, `/stores/:id`, `/stores/:id/displays`, `/displays/:id`, `/products`, `/products/:id`, `/pogs`, `/pogs/:id` | Real (feature 04; context/api-contracts.md). Other `/api/v1/*` paths return the JSON `404` envelope. |
| Configuration validation | Real, for admin and worker. |
| Web sign-in, reset, invite acceptance, sign-out | Real (Supabase Auth, httpOnly SSR cookies). Pages require a verified session; employees are sent to the iOS app. |
| Admin pages | Overview, Members, Stores, Displays, Products and POGs (reference-image/rectangle editor, immutable publication and cloning) are real. Scans UI/workflows are not built. |
| iOS app | Real sign-in, Keychain session, refresh, sign-out, reset request, authorized store list; History is an empty state. Compiled and tested for macOS only (no Xcode). |
| Vision analysis | `MockVisionAdapter` returns the fixed fixture (one known count, one unknown occluded slot) for the requested slot IDs. No network. |
| Database | Real (local): schema, RLS, triggers, private buckets, `publish_pog_version`, `create_scan`. See supabase/README.md. |
| Job queue | Table exists; claiming/processing not implemented. The worker idles. |

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
