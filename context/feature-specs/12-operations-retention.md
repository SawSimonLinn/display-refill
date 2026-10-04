# Operations, Retention and Recovery

## Status
Local operations foundation implemented. Acceptance remains incomplete: owner-approved policy, staging/production deployment, monitoring delivery, rollback and full database/Storage restore rehearsal are outstanding. See progress-tracker.md for synthetic local evidence.

## Dependencies
Feature(s): 09, 11. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Implement deployment/config validation, structured telemetry, daily retention cleanup and job recovery alarms. Establish approved retention policy and test environment separation. Follow operations-runbook.md with a staging drill for provider outage, worker restart and image deletion. Private media and signed links never enter logs. Add operator-controlled vision disable switch while manual services remain available. Document migrations, backups and restore responsibilities without assuming a hosting plan feature.

## Acceptance Criteria
- Staging works with independent API and persistent worker lifecycles.
- Lease recovery and manual fallback succeed during outage drills.
- Retention removes expired photos and updates metadata idempotently.
- Application logs contain identifiers/error codes but no secrets or image links.
- Rate/concurrency limits and cost telemetry are demonstrable.
- Backup/restore and rollback procedures are documented and rehearsed.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
