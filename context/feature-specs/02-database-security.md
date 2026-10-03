# Database, Constraints and Security

## Status
Complete on local Supabase 2026-10-03: every acceptance criterion demonstrated (88 DB integration tests, from-empty instance, see progress-tracker.md). Not applied to any hosted project. Transactional functions beyond publish/scan snapshot belong to later features (decision D29). See progress-tracker.md.

## Dependencies
Feature(s): 01. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Implement data-model.md in migrations in the stated order. Enable RLS before exposing tables. Add membership helpers, tenant foreign keys, private buckets, indexes, upload intents and narrowly granted transactional functions. Implement two-organization synthetic seeds for tests. Do not use a client-writable role column. Publish and scan snapshot functions must validate same-organization relationships. Reserve raw AI, audit, job and confirmation writes for trusted services.

## Acceptance Criteria
- A fresh local database migrates and seeds reproducibly.
- Cross-store/cross-organization reads and direct privileged writes fail under real authenticated roles.
- Invalid coordinates, fractional counts, invalid thresholds and mismatched tenant FKs fail.
- Anonymous access to both private image buckets fails.
- Published rows cannot be edited even if a UI bug attempts it.
- Generated TS types match the applied schema; no production reset commands in scripts.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
