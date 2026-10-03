# Authentication and Permissions

## Identity
Supabase Auth email/password only for MVP. Admin invites users; public signup is disabled. Invite acceptance and password reset use allowlisted web/mobile redirect destinations. Initial organization admin is provisioned through a documented operator-only bootstrap; never “first user becomes admin.” SDK versions and redirect handling must be verified during implementation.

Web sessions use Supabase SSR cookie integration. iOS sends `Authorization: Bearer <access_token>`. Verify tokens server-side using supported Supabase verification; do not trust decoded claims without verification. Query active memberships for authorization. Logout clears user data and local images; revoked membership blocks subsequent API calls even if the access token has not expired.

## Permission Matrix
| Action | Employee | Manager | Admin |
| --- | --- | --- | --- |
| View assigned store, displays and active POG | Assigned stores | Assigned stores | Organization |
| Create photo/manual scan | Assigned stores | Assigned stores | Organization |
| Read scan history | Assigned stores | Assigned stores | Organization |
| Edit/confirm unconfirmed scan | Own scans | Any in assigned stores | Organization |
| Complete confirmed refill | Own scans | Any in assigned stores | Organization |
| Create/rename/archive displays; assign published POG | No | Assigned stores | Organization |
| View product/POG catalog | Relevant active layout data | Organization catalog | Organization |
| Create/edit products, draft/publish reusable POGs | No | No | Organization |
| Create/archive stores | No | No | Organization |
| Invite/revoke/change memberships | No | No | Organization |
| Review correction history | Store scan detail | Assigned stores | Organization |
| Export training candidates or change retention | No | No | Organization |

Managers configure store display assignments; reusable catalog/POG authoring is admin-only to avoid a manager changing other stores' layouts. This is the chosen MVP boundary. A user can be manager in one store and employee in another. Admin is organization-scoped, never global across tenants.

## API and RLS
Deny anonymous application data. Authenticated SELECT policies match the matrix. Use a caller-scoped Supabase client for normal reads. Deny direct client mutations to counts, refill quantities, published POGs, audit, memberships, jobs, attempts, and upload intents. Writes flow through authorized API services and narrowly scoped transactional functions. Service-role secrets bypass RLS and therefore require explicit organization/store checks before every privileged call.

Never authorize by a supplied store_id alone: join requested resource to its stored store and organization, then membership. POG reference access for employees is limited to versions assigned to accessible displays or pinned to accessible historical scans. Do not expose profiles or membership rosters across organizations. Manager-facing history may show actor display names through a constrained projection, not unrestricted auth.users access.

## Storage Authorization
Both buckets are private. Upload grants bind actor, exact generated path, size/type policy, resource, and short expiration. No overwrite. General client DELETE and UPDATE are denied. Download links require current resource access and expire after 5 minutes; links already issued can remain valid until expiry after membership revocation. Do not log or persist signed URLs. Worker fetches via private service access. Keep any provider image URL lifetime shorter than necessary for its request.

## Implementation (feature 02)
RLS policies and helpers are in `supabase/migrations/`; layout visibility follows decision D25. Clients have SELECT-only grants (D21); there are no client INSERT/UPDATE/DELETE policies. Profiles: users see their own; org admins see profiles of their organization's members. Memberships: users see their own rows; org admins see their organization's. Audit events: org admins only. Verified by `tests/db` with real signed-in users (see progress-tracker.md).

## Required Negative Tests
Cross-store ID substitution, cross-organization POG assignment, employee role escalation, expired session, revoked membership with live token, direct table writes, guessed storage path, editing someone else's scan, writing published slots, and client-supplied refill totals must fail. Test real RLS roles separately from service-role API tests.
