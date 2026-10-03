# Supabase

Local Supabase project for Display Refill: schema, RLS, storage buckets,
trusted functions and synthetic seed data. Everything here targets the
**local** stack; no script links, pushes to or resets a hosted project
(`npm run check:db-scripts` enforces this).

## Layout

| File | Contents |
| --- | --- |
| `config.toml` | Local stack config. Public signup disabled; realtime, edge runtime and analytics off |
| `migrations/…0100_identity_stores.sql` | Organizations, profiles, memberships, stores; `private` authorization helpers; last-admin guard |
| `migrations/…0200_catalog_pogs.sql` | Products, POGs, versions, slots, displays; coordinate/quantity checks; publish validation and immutability triggers |
| `migrations/…0300_scans.sql` | Scans, pinned slot snapshots, append-only corrections/confirmations; layout-data read policies |
| `migrations/…0400_jobs_audit_uploads.sql` | Jobs, attempts, upload intents, idempotency, audit (service-only) |
| `migrations/…0500_storage_grants_functions.sql` | Private buckets, client grant lockdown, `publish_pog_version`, `create_scan` |
| `migrations/…0600_publication_locks.sql` | Row locks closing publish-vs-slot-edit and publish-vs-product-archive races; scans may pin only published versions |
| `migrations/…0700_tenant_indexes.sql` | `pog_slots(organization_id)` index (every tenant table now has one) |
| `seed.sql` | Two synthetic organizations (IDs in `tests/db/src/seed-ids.ts`); no users or passwords |

## Commands (repo root)

```bash
npm run db:start        # supabase start (needs a Docker-compatible runtime)
npm run db:reset        # supabase db reset --local: migrations + seed from empty
npm run db:types        # regenerate packages/server/src/database.types.ts
npm run db:types:check  # fail if generated types differ from the applied schema
npm run test:db         # RLS/constraint/storage/function tests (local only)
npm run check:db        # reset + types check + tests
npm run db:stop
```

For a from-empty check of the whole local instance (including `auth.users` and
storage), run `npx supabase stop --no-backup && npm run db:start`. This deletes
only the local Docker volumes for this project.

The test harness reads URLs and keys from `supabase status` and refuses to
run unless the API and database are loopback addresses. Test users are created
per run through the Auth admin API with random passwords that are never stored.

## Security model (summary)

- RLS is enabled on every table. Clients (`authenticated`) get **SELECT only**,
  filtered by policies; `anon` gets nothing. Default privileges are revoked so
  future tables start with no client grants.
- All writes go through the API using the service role. Multi-row operations
  use `publish_pog_version` and `create_scan`, which only `service_role` may
  execute. They take the API-verified actor and re-check membership and tenant
  relationships themselves.
- Triggers enforce rules that hold for every role, including the service role
  and the database owner: published versions and their slots are immutable,
  publication validates slots, displays only reference published versions,
  scans are never deleted, corrections/confirmations/audit are append-only,
  confirmed counts are frozen, an organization keeps at least one admin.
- Both storage buckets are private with no object policies; clients cannot
  list, read, write or delete objects. Signed URLs are issued by the server.

## Colima note

If Docker's config names a credential helper that is not installed (for
example `"credsStore": "desktop"` left by Docker Desktop), image pulls fail.
Either fix `~/.docker/config.json` or run with a clean config:

```bash
export DOCKER_CONFIG=/path/to/dir-with-empty-config DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
```
