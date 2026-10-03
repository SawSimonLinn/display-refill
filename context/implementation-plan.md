# Phased Implementation Plan

No application code is delivered by this context package. Each phase ends with a demonstrable checkpoint; timing depends on developer availability and pilot findings.

| Phase | Features in order | Exit gate |
| --- | --- | --- |
| 0 — Foundation | 01 repository/contracts, 02 schema/security, 03 authentication | Both clients authenticate; cross-store access fails |
| 1 — Configuration | 04 catalog/displays, 05 POG builder/publication | Admin publishes a layout and manager assigns it; employee can read it |
| 2 — Useful manual MVP | 06 refill engine, 07 manual iOS flow | Employee enters counts, confirms a correct list, completes and reopens it |
| 3 — Photo analysis | 08 capture/storage, 09 worker/vision | Photo reaches durable worker; validated observations return with uncertainty |
| 4 — Operational workflow | 10 correction/review, 11 history/admin review | Full photo → review → confirm → complete flow, audit and access checks |
| 5 — Pilot release | 12 operations/retention, 13 evaluation/release | Real-device and store pilot gates pass; recovery runbook exercised |

Feature 10's core count-review API/UI is introduced by feature 07; feature 10 adds AI comparison, required verification and correction provenance. Feature 11 expands the basic reopen endpoint needed by feature 07 into searchable history. Do not defer security or error handling to the last phase.

## First Agent Task
Implement feature 01 only: scaffold the proposed repository, document selected versions, add health/config validation and shared contract skeletons, run baseline checks. Do not build photo analysis first. Next implement schema/RLS with seeded users in isolated local Supabase, then sign-in.

## Increment Template
Scope → schema/API changes → UX states → negative paths → verification evidence → context update. Prefer a PR or commit per coherent increment. Add migrations before clients depend on new fields. Deploy compatible additions before removing old contracts.

## Parallel Work Boundaries
If the owner later requests parallel implementation, assign exclusive paths and agree on API/schema contracts first. iOS shell can use fixed fixtures while the backend implements manual counting. POG publication and scan snapshotting must share the same version contract. No parallel-agent work is required by this plan.
