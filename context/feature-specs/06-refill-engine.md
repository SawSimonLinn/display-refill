# Authoritative Refill Engine

## Status
Not started.

## Dependencies
Feature(s): 02. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Implement one pure TypeScript domain function for slot refill, product aggregation and optional fill score using refill-rules.md. Wrap it in transactional scan count/confirmation services. Validate quantities before computation. Targets, products and triggers come exclusively from pinned database snapshots. The API returns provisional results during review and immutable final values at confirmation. Neither SwiftUI nor provider output is the business-rule authority.

## Acceptance Criteria
- Every fixture in examples/refill-cases.json passes.
- Unknown blocks confirmation and yields null aggregate/score where specified.
- Inclusive trigger equality, overstock and repeated-product aggregation are covered.
- Client attempts to inject targets or totals are rejected.
- Concurrent confirmation of one revision commits once.
- Frozen confirmed results stay stable after catalog/POG changes.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
