# Display Refill

Display Case Refill Scanner: employees check a store display against its
planogram (POG) and get a refill list. SwiftUI app for employees, Next.js
admin dashboard and API, Supabase Auth/Postgres/Storage, and a persistent
TypeScript worker for photo analysis.

**Status: features 01 (foundation) and 02 (database and security).** The
local schema, RLS and storage exist; there is no sign-in UI, no business API
and no real vision provider yet. See
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
scripts/                 Repository checks
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
| supabase-js / pg | 2.117.2 / 8.23.1 | database tests |
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

# Database (needs local Supabase running: npm run db:start)
npm run check:db            # reset from empty + generated-types check + DB tests
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

Use the values from `npx supabase status` (local stack). The API does not
query the database yet; only configuration is validated.

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
| `GET /api/v1/health` | Real. Reports `database: not_checked`, `authentication: not_implemented`, `job_queue: not_implemented`. |
| Other `/api/v1/*` | JSON `404 NOT_FOUND` envelope. No business endpoints yet. |
| Configuration validation | Real, for admin and worker. |
| Sign-in (web and iOS) | **Placeholder.** Disabled form; no Supabase Auth calls; no pages are protected. |
| Admin pages | Navigation shell with "Not built yet" placeholders. No data. |
| iOS app | Sign-in placeholder, server reachability check, Check/History tab shell with empty states. |
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
