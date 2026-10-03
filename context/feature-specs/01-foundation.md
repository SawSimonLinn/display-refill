# Repository and Contract Foundation

## Status
Implemented 2026-10-03; TypeScript side verified, iOS build unverified (no Xcode). See progress-tracker.md for evidence and open items.

## Dependencies
Feature(s): None. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Create the proposed monorepo layout, SwiftUI target and Next.js App Router admin/API app. Pin dependencies and toolchains, add server-only configuration validation, shared JSON naming conventions, and mock API/vision fixtures. Provide minimal sign-in placeholders and health endpoint without claiming authentication exists. Set up semantic UI tokens and native navigation shells. Record the chosen iOS target after checking available devices.

## Acceptance Criteria
- Apps and worker build independently from documented commands.
- Missing server configuration fails with a useful message without printing secrets.
- Client bundles/mobile configuration contain only publishable Supabase configuration.
- Lint/typecheck and a Swift build run; results and unavailable device checks are recorded.
- README explains how to start local API/worker and which behavior is mocked.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
