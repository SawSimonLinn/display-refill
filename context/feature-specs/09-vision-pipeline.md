# Durable Vision Analysis

## Status
Implemented locally with the deterministic mock adapter; acceptance criteria demonstrated by local DB/API/worker/Swift tests and a simulator run (see progress-tracker.md). Real provider selection, benchmark and data-handling review remain open, so live vision is not available.

## Dependencies
Feature(s): 08. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Implement the database-backed queue and worker in scan-lifecycle.md, starting with a deterministic adapter fixture. Provider adapter receives validated image/reference/slot data and returns vision-contract.md output only. Validate schema/IDs/counts and persist attempts plus observations. Apply confidence/quality rules server-side. Preserve null counts, fence writes by lease+generation, enforce retry/cost limits, and expose polling states to iOS. Select a real provider only after a small benchmark and data-handling review.

## Acceptance Criteria
- Mock good/poor-alignment/occluded/invalid responses produce correct review or failure state.
- Timeout, retryable errors and permanent errors follow the documented budget.
- Worker restart reclaims expired work without duplicating accepted results.
- Manual takeover during provider call prevents late writes.
- Missing slot output becomes unknown; wrong/duplicate IDs cannot be accepted.
- Provider/model/prompt versions and usage are recorded without leaking secrets.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
