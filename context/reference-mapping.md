# Reference Mapping and Provenance

Read all seven Markdown attachments from the referenced “Display Refill App Planning” conversation. They supplied document organization and concise implementation guidance, not transferable product behavior or completion evidence. Also read the full available planning conversation. The original two photos were not used to extract actual product quantities or slot coordinates; examples here are synthetic.

| Uploaded reference | Project-specific treatment |
| --- | --- |
| project-overview.md | Rewritten as display refill goals, employee workflow, scope and pilot targets |
| architecture-context.md | Replaced collaborative canvas with native iOS + admin/API + Supabase + vision worker |
| ai-workflow-rules.md | Preserved incremental spec-driven workflow, adapted boundaries and evidence requirements |
| ui-context.md | Replaced technical dark canvas with accessible employee/admin interfaces and POG editor |
| code-standards.md | Added Swift, SQL/RLS, server validation and durable job conventions |
| current-issues.md | Removed unrelated auth warning; records planning risks and no claimed runtime defects |
| progress-tracker.md | Reset unrelated completed work; all application features explicitly not started |

## Removed Assumptions
Ghost AI is not the product. Clerk is not used; Supabase Auth is mandatory. Prisma is replaced by SQL migrations and Supabase clients. Liveblocks and collaborative React Flow rooms are unnecessary. Trigger.dev is replaced by an explicit Postgres queue with a TypeScript worker. Vercel Blob is replaced by private Supabase Storage. No dependency on any of those removed systems should be introduced by following this package.

## Added Material
README/index, feature specs, schema, access matrix, API contracts, deterministic refill rules, versioned scan lifecycle, image geometry/vision contract, retention, setup, decisions, testing, delivery phases, operational recovery and synthetic examples address gaps needed for incremental implementation.

## Authority
Current user request > project-specific contracts > illustrative examples > historical planning discussion. The historical conversation included ideas and aspirational timing; this package resolves implementation defaults explicitly and leaves uncertain external choices open. It does not claim code from the reference project has been migrated.
