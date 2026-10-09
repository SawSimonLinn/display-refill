# Display Case Refill Scanner — Implementation Context

A complete planning handoff for an employee SwiftUI app, Next.js/TypeScript admin/API, and Supabase Auth/Postgres/Storage backend. Supabase Auth is mandatory. Start with manual counts and single-image scans; live video/AR and custom model training are outside MVP.

This folder contains specifications. Features 01 (repository foundation), 02 (database and security), 03 (Supabase Auth and memberships), 04 (store, display and product management), 05 (POG builder/reference validation/publication), and 06 (authoritative backend refill engine) are implemented; Feature 07 runs as an actual iOS app (spoken VoiceOver and physical device still unverified); Feature 08 photo capture/storage is implemented with simulator evidence (physical camera unverified); Feature 09 durable analysis is implemented locally with a deterministic mock adapter only (no real provider selected); Feature 10 estimate review/corrections is implemented locally against that mock output (spoken VoiceOver and physical device unverified); Feature 11 history/manager review is implemented locally on iOS (simulator) and web (spoken VoiceOver and physical device unverified); Feature 12’s operations foundation is implemented locally with synthetic cleanup/recovery evidence; staging/production acceptance remains open. Feature 13 local preparation has started; [pilot readiness packet](pilot/readiness.md) separates implemented behavior, verified evidence and outstanding release gates. Features 03–06 are verified locally; the iOS simulator/device build and hosted email paths are not (see the tracker). The repository README at the root explains how to run what exists; [progress tracker](progress-tracker.md) records verification evidence. The seven uploaded Markdown references have been rewritten, with their filenames preserved. See [reference mapping](reference-mapping.md) for provenance and removed assumptions.

## Current owner-requested workflow

[Feature15 — Stock Check and Shared Prep List](feature-specs/15-stock-check-shared-prep.md) extends [Feature14](feature-specs/14-production-worksheet.md). Employees count sections or update one product during the day, and a shared grouped prep list tracks partial preparation, Done, actor/time and amounts still needed. PAR remains manager-only. Photos are deferred. Counts and preparation carry forward until replaced; see the tracker for verification and open device checks.

## Read First
1. [Project overview](project-overview.md) — purpose, scope, workflow and success targets.
2. [Architecture](architecture-context.md) — stack, system boundaries and invariants.
3. [Development workflow](ai-workflow-rules.md) and [code standards](code-standards.md).
4. [Implementation plan](implementation-plan.md) and [progress tracker](progress-tracker.md).
5. The next feature spec below and its domain contracts.

## Domain and Delivery Index
| Document | Use |
| --- | --- |
| [Data model](data-model.md) | Tables, constraints, snapshots and migration order |
| [Auth and permissions](auth-and-permissions.md) | Identity, employee/manager/admin matrix, RLS and storage |
| [API contracts](api-contracts.md) | Routes, payloads, errors, idempotency and concurrency |
| [Refill rules](refill-rules.md) | Inclusive thresholds, unknown handling, aggregation and score |
| [Scan lifecycle](scan-lifecycle.md) | States, jobs, retries, leases and manual takeover |
| [Vision contract](vision-contract.md) | Geometry, schema, prompt, confidence and provider boundary |
| [Storage and retention](storage-and-retention.md) | Private media, validation, cleanup and future training |
| [UI context](ui-context.md) | Employee/admin screens, accessibility and error states |
| [Development setup](development-setup.md) | Proposed app directories, environment and official references |
| [Testing and acceptance](testing-and-acceptance.md) | Security tests, failure cases and pilot release gates |
| [Operations runbook](operations-runbook.md) | Deployment, monitoring, outage recovery and retention |
| [Decision log](decision-log.md) | Fixed decisions, defaults and open questions |
| [Current issues](current-issues.md) | Known risks; no fabricated runtime bugs |

## Feature Specs in Delivery Order
1. [Repository and Contract Foundation](feature-specs/01-foundation.md)
2. [Database, Constraints and Security](feature-specs/02-database-security.md)
3. [Supabase Authentication and Memberships](feature-specs/03-auth.md)
4. [Store, Display and Product Management](feature-specs/04-store-display-product-management.md)
5. [POG Builder and Publication](feature-specs/05-pog-builder.md)
6. [Authoritative Refill Engine](feature-specs/06-refill-engine.md)
7. [iOS Manual Workflow](feature-specs/07-ios-manual-workflow.md)
8. [Photo Capture, Import and Storage](feature-specs/08-photo-capture-storage.md)
9. [Durable Vision Analysis](feature-specs/09-vision-pipeline.md)
10. [Confidence Review and Correction Capture](feature-specs/10-count-review-corrections.md)
11. [Scan History and Manager Review](feature-specs/11-history-admin-review.md)
12. [Operations, Retention and Recovery](feature-specs/12-operations-retention.md)
13. [Pilot Evaluation and Release](feature-specs/13-pilot-release.md)
14. [Production Worksheet — HAVE / MAKE](feature-specs/14-production-worksheet.md)
16. [Self-service Stores and Display Case Types](feature-specs/16-self-service-stores-display-types.md)

## Examples
- [POG draft](examples/pog-draft.json): synthetic normalized rectangles; product names are illustrative, not a ready-to-submit API payload.
- [Vision response](examples/vision-response.json): one known count and one unknown count requiring review.
- [Refill test cases](examples/refill-cases.json): expected deterministic outcomes and invalid-input fragments.

Examples are fixtures for implementing tests, not evidence that tests have run. No real credentials, user records or store photos are included.

## Key Decisions for the Next Agent
- Use Supabase Auth for both clients and enforce database-backed membership on every request.
- A published POG is immutable; every scan pins a version and copies operational slot metadata.
- Coordinates alone do not solve perspective or hidden stock. Uncertain counts require human verification.
- Vision counts; the backend calculates refill. Null is unknown, never empty.
- Persist AI evidence separately from human corrections and final confirmation.
- Durable worker results cannot overwrite manual takeover or newer human revisions.
- Confirmed counts are historical evidence; completion is an employee attestation.

Resolve conflicting requirements by updating the relevant contract and decision log before changing code. Keep progress evidence truthful. Open verification: device/VoiceOver checks for Features 07–10 and a provider benchmark before live vision. Next work: Feature 12 hosted/policy acceptance after owner decisions; Feature 13 pilot preparation is in progress; no real-store or real-provider acceptance is demonstrated.

- [Offline Build Book and compact Prep presentation](pilot/build-book.md)
- [Waste Log and made/waste reporting](feature-specs/14-waste-and-made-reporting.md)
- [Hosted staging and TestFlight pilot](pilot/staging-testflight.md)
