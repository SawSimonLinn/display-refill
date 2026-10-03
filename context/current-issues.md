# Current Issues and Risks

## Implementation Status
Feature 01 scaffold exists (see progress-tracker.md). No application runtime defects are known. Machine/toolchain problems found during feature 01 are listed under Observed Environment Issues; authentication, schema and vision are not implemented.

## Known Product / Technical Risks
| ID | Risk | Mitigation / evidence needed | Status |
| --- | --- | --- | --- |
| R01 | Hidden containers cannot be counted from one image | Physical verification and unknown state; evaluate actual case layouts | Open |
| R02 | Normalized coordinates do not solve camera perspective | Standard framing/crop and alignment quality gate | Open |
| R03 | Model confidence is uncalibrated | Benchmark high-confidence error and review routing | Open |
| R04 | Similar packaging or misplaced items | Expected product hints, mismatch flag and human review | Open |
| R05 | Service-role API bypasses RLS | Explicit resource authorization plus negative integration tests | Specified; untested |
| R06 | Worker duplicate/late results corrupt human review | Lease fencing, generation and revision transactions | Specified; untested |
| R07 | Shared POG edits rewrite history | Immutable versions and slot snapshots | Enforced in the database, including under concurrent publication (feature 02 tests); API path untested |
| R08 | Vision latency/cost exceeds pilot needs | Durable queue, measurement, capped retries, manual flow | Open |

## Observed Application Defects
| ID | Observed | Reproduction | Fix / verification | Status |
| --- | --- | --- | --- | --- |
| A01 | A slot inserted into a draft while `publish_pog_version` was in flight committed into the published version, bypassing overlap validation and immutability. A scan could also be inserted pinned to a draft version | `tests/db/test/concurrency.test.ts` (two raw connections) | Migration `…0600_publication_locks.sql`: `FOR SHARE` locks in the slot guard and publish validation, plus a published-only pin trigger on scans. Tests fail without it and pass with it | Resolved 2026-10-03 |

## Observed Environment Issues (feature 01 machine)
| ID | Observed | Impact | Workaround / next step | Status |
| --- | --- | --- | --- | --- |
| E01 | Xcode not installed (only Command Line Tools) | iOS build, simulator and device runs unverified; `xcodegen`/`xcodebuild` not run | Install Xcode, then follow apps/ios/README.md | Open |
| E02 | CLT SwiftPM cannot link any `Package.swift` (undefined `PackageDescription.Package.__allocating_init`, all tools-versions) | `swift build`/`swift test` unusable | `apps/ios/scripts/swiftc-check.sh` compiles with plain swiftc | Open; reinstall CLT or install Xcode |
| E03 | Stale CLT `usr/include/swift/module.modulemap` (2023) redefines `SwiftBridging` alongside `bridging.modulemap`; `_Testing_Foundation.framework/Modules` empty | Foundation/SwiftUI imports fail without a VFS overlay | Overlay + `-disable-cross-import-overlays` via `SWIFTC_FLAGS` (apps/ios/README.md) | Open; system files left untouched |
| E04 | swiftly lists toolchain 6.2.1 that is missing on disk | `~/.swiftly/bin/swift` fails | Use `/usr/bin/swift` | Open |
| E05 | Supabase CLI and Docker not installed | No local Supabase | Feature 02 installed Colima + Docker CLI (Homebrew) and Supabase CLI 2.119.0 (npm devDependency) | Resolved 2026-10-03 |
| E07 | `~/.docker/config.json` has `"credsStore": "desktop"` (left from Docker Desktop) but `docker-credential-desktop` is not installed | `supabase start` image pulls fail | Run with `DOCKER_CONFIG` pointing at an empty config and `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` (supabase/README.md); user config left untouched | Open; owner may remove the `credsStore` line |
| E08 | `apps/admin/package.json` now pins `eslint-config-next` `^14.2.35` (was `16.3.8`). Changed 2026-10-03 00:14 local, not by the feature 02 agent; matches what `npm audit fix --force` suggests for E06 | `npm run lint` fails: v14 has no flat-config entry points for ESLint 9 (`Cannot find module …/core-web-vitals`) | Restored `eslint-config-next` `16.3.8` (exact pin, matches `next` 16.3.8; bundled Next 16 docs use the flat-config imports in `eslint.config.mjs`). Lockfile changes are ESLint-toolchain only. `npm run lint`: 0 problems over 23 files; probes caught `no-explicit-any` and `@next/next/no-img-element` | Resolved 2026-10-03 |
| E06 | `npm audit`: 5 high findings, all via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` (dev-only lint toolchain) | Not shipped in app or worker bundles | Re-check when `eslint-config-next` updates; do not `audit fix --force` (it downgrades to v14 and breaks lint, which caused E08). Returned with the E08 fix as expected; `npm audit --omit=dev`: 0 vulnerabilities | Open |

## Issue Recording Template
ID, observed behavior, expected behavior, reproduction steps, environment, severity, owner, affected feature, sanitized evidence, proposed fix, verification outcome. Separate observed defects from planning risks. See decision-log.md for unanswered choices.
