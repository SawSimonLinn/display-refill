# Code Standards

## General
Small modules, explicit boundaries, no hidden network calls in presentation code. Use UUID identifiers, UTC RFC3339 timestamps over HTTP, Postgres timestamptz, and store IANA time zones for display. Quantities are integers; null means unknown. Never use floating point for counts.

## TypeScript and Next.js
Strict TypeScript; validate unknown input with runtime schemas. Avoid `any`. Use discriminated unions for scan states and version contracts. Prefer Server Components; use client components for capture-independent browser interaction such as the POG editor. Route handlers authenticate, authorize, validate, call services, and serialize. User-specific pages and responses must not enter shared caches. Cookie-authenticated mutations require same-origin/CSRF protection; iOS bearer requests do not depend on cookies.

## Swift
Use Codable request/response types and explicit CodingKeys for snake_case. Use structured concurrency, cancellation, and MainActor-isolated presentation state. Keep capture/image normalization outside view bodies. Wrap API, auth, and capture behind protocols for test doubles. Store refresh credentials securely in Keychain-compatible persistence; do not assume a default SDK storage implementation meets that requirement. Refresh once on 401, retry at most once, and avoid duplicate mutations with idempotency keys.

## Database
SQL migrations are versioned and reproducible from an empty local database. Generate TS types after schema changes. Add foreign keys, check constraints, tenant consistency constraints, and indexes with each table. RLS on every exposed application table. Definer functions require a fixed search_path, narrow grants, and explicit caller checks; ordinary user-callable RPCs must not accept a caller identity as authority. Never rely on UI hiding to protect writes.

## API and Jobs
Stable error codes, request IDs, cursor pagination, input limits, and optimistic concurrency. Use database transactions for publication, enqueue, confirmation, and corrections. Worker leases and fencing tokens protect against duplicate delivery. Secrets and provider calls belong in server-only modules. Never accept an arbitrary remote image URL to fetch.

## Tests
Unit-test refill and state transitions. Integration-test migrations/RLS, storage isolation, transactions, and worker crash recovery. Test iOS review/capture failure states with mocked services and a real-device camera pass. Use browser end-to-end tests for admin publish and role denial. No network calls to a paid vision API in ordinary CI; use fixed response fixtures.
