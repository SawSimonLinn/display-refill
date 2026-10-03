# Development Workflow

## Approach
Use a spec-driven workflow. Read the README, architecture, data model, authorization rules, and current feature spec before editing code. Start with manual counts and deterministic calculations; add image analysis after the complete manual workflow works.

## Scoping Rules
Implement one independently verifiable unit at a time. A vertical unit may include its migration, API, UI, and tests when necessary to demonstrate the behavior. Split unrelated subsystems, schema redesigns, or provider changes into separate increments. Do not invent completed work or silently add product scope.

## Handling Missing Requirements
Use documented defaults in decision-log.md. Record a new decision before implementation when it changes API, permissions, calculation semantics, or privacy. Ask the owner only for a material missing decision that blocks that unit; continue independent work. Do not treat open provider selection as a blocker to a mock adapter or manual workflow.

## Protected Foundations
Keep generated SDK/database types generated, not hand-edited. Prefer app-level composition over modifying generated shadcn components or vendored internals. Never place service credentials in client bundles, mobile configuration, examples, or logs. Never modify synced source/reference documents.

## Keeping Docs in Sync
Update feature specs and contracts when behavior changes. Update progress-tracker.md with actual files, verification commands/results, remaining limitations, and next unit. Add reproducible failures to current-issues.md. Do not mark a feature complete solely because the UI exists.

## Before Moving to the Next Unit
1. Acceptance criteria are met with evidence.
2. Database authorization is tested with real authenticated non-admin identities.
3. Error paths and retry behavior are exercised where relevant.
4. No architecture invariant is violated.
5. Relevant docs and progress records match implementation.

## Agent Handoff
Report implemented behavior, changed files, migrations, tests run, untested paths, blockers, and the next smallest feature. This package is planning material; no application implementation has been verified yet.
