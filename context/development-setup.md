# Development Setup

## Proposed Repository
```text
display-refill/
  apps/ios/DisplayRefill/       # SwiftUI app, tests, configuration templates
  apps/admin/                 # Next.js admin and API
  packages/domain/            # Validation, refill engine, contracts
  packages/server/            # Authz, transactions, storage, vision adapter
  workers/scan-worker/        # Persistent TypeScript process
  supabase/migrations/       # Schema, policies, transactional functions
  supabase/seed.sql          # Synthetic data only
  tests/                     # Contract, integration, end-to-end fixtures
  context/                   # This documentation package
```
Feature 01 implemented this layout with the repository at the project root (no `display-refill/` wrapper), plus `scripts/` for repository checks and `apps/ios/DisplayRefillKit/` for the Swift package. `supabase/` exists but is empty until feature 02. The root README lists exact tool versions and commands.

## Prerequisites and First Run
Use a supported Node LTS, package manager lockfile, Xcode/Swift toolchain compatible with the selected iOS deployment target, and Supabase CLI/local runtime. Exact versions recorded during feature 01 are in the root README (Node 22.13.1, npm 11.18.0, Next.js 16.3.8, TypeScript 5.9.3, Swift 6.2.3). Xcode, the Supabase CLI and Docker were not installed on that machine. Provisional minimum iOS target: iOS 17.0; verify against actual store devices before committing. Create separate local, staging, and production Supabase environments. Never run fixture resets against production.

1. Scaffold admin, domain/server packages, worker and iOS target.
2. Add safe configuration examples below, ignoring local secrets.
3. Start local Supabase, apply migrations and synthetic seed.
4. Provision test identities locally and associate memberships; do not seed plaintext real passwords.
5. Generate DB types and start API + worker with mock vision adapter.
6. Configure iOS API/Supabase URLs and camera purpose string; run simulator manual flow.
7. Run integration suite, then use a device for camera validation.

## Environment Contract
| Variable | Runtime | Secret? |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Web | No |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Web | No; RLS still required |
| SUPABASE_URL | API/worker | No |
| SUPABASE_SERVICE_ROLE_KEY | Server/worker only | Yes |
| DATABASE_URL | Worker/migration tooling only | Yes |
| VISION_PROVIDER | Worker | No; mock in development |
| VISION_MODEL | Worker | No |
| VISION_API_KEY | Worker | Yes |
| APP_ORIGIN | API | No; CSRF/redirect origin |
| SCAN_IMAGE_RETENTION_DAYS | Cleanup worker | No; default 90 |
| SCAN_METADATA_RETENTION_DAYS | Cleanup worker | No; proposed 365 |
| LOG_LEVEL | Server/worker | No |

iOS configuration: API_BASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, allowed auth callback URI. No database URL, service-role key, or provider key in the app. The server key variable names are application conventions; use project-compatible Supabase server credentials and verify SDK support during setup.

## Official References
Use [Supabase Next.js Auth](https://supabase.com/docs/guides/auth/quickstarts/nextjs) and [SSR client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs) for implementation details. Web SSR uses the SSR package alongside the client library; see [package selection](https://supabase.com/docs/guides/auth/choosing-a-server-package). Private image access follows [Storage access control](https://supabase.com/docs/guides/storage/security/access-control). Verify current Swift SDK and Apple capture APIs when coding; this package does not freeze external SDK method signatures.
