# Authentication and Permissions

## Identity
Supabase Auth email/password only for MVP. Admin invites users, or (Feature 16, D105) anyone signs up with email confirmation and joins with the organization access code; a signed-up account without a membership can read only its onboarding state. Invite acceptance and password reset use allowlisted web/mobile redirect destinations. Initial organization admin is provisioned through a documented operator-only bootstrap; never “first user becomes admin.” SDK versions and redirect handling must be verified during implementation.

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

## Implementation (feature 03)
- **Identity:** Supabase Auth email/password only (`[auth] enable_signup = false`). Accounts come from `POST /api/v1/members/invite` or the operator bootstrap (`scripts/bootstrap-admin.mjs`, decision D38). No other identity provider is installed.
- **Token verification:** every API request and dashboard render verifies the access token with Supabase Auth (`getUser`), so a signed-out session's token is rejected before it expires (D30). Memberships are then read with a caller-scoped client (RLS applies) on every request; nothing is cached across requests and `user_metadata` is never read for authorization (tested by setting `role: admin` in metadata).
- **Web:** `@supabase/ssr` with httpOnly, SameSite=Lax cookies; `src/proxy.ts` refreshes an expired session once per request and clears cookies when the refresh token is rejected. Auth forms are same-origin-checked POSTs (D34). Admins and store managers may open the dashboard; employees and revoked users are sent to `/no-access`. Members is admin-only (page and API). Sign-out revokes the session (`scope=local`), deletes cookies and sends `Clear-Site-Data: "cache", "storage"`.
- **iOS:** `SupabaseAuthClient` (D31) + `SessionManager` actor: Keychain item (`AfterFirstUnlockThisDeviceOnly`), proactive refresh 60 s before expiry, single-flight refresh, one refresh and one retry per 401, sign-out on rejected refresh, session kept on network failure. Sign-out clears the Keychain item, HTTP caches and the app's image directories, then revokes the session.
- **Email links:** invite and recovery templates link to `APP_ORIGIN/auth/confirm?token_hash=…&type=…`; the server always builds `redirect_to` from `APP_ORIGIN`. A `next` parameter only accepts known in-app paths (`safeNextPath`). Observed locally: Supabase Auth replaces a `redirect_to` outside `additional_redirect_urls` with `site_url`, but accepts any path or port on the **site_url host** (so keep `site_url` on the app's own domain).
- **Memberships:** `apply_membership_invite`, `update_membership`, `list_organization_members` (admin roster incl. email via SECURITY DEFINER), `bootstrap_first_admin`; all service-role only and audited (`membership.invited|updated|revoked|bootstrapped`). The last-admin trigger now locks the organization row, closing a concurrent demotion race (current-issues A02).

## Implementation (feature 04)
- Writes go through service-role-only functions that take the API-verified actor, load the target row `FOR UPDATE`/`FOR SHARE`, derive organization and store from it and re-check the actor: org admin for stores, products and POGs; `is_store_manager` (manager of that store or org admin) for displays. No organization or store ID in a request can widen access; PATCH bodies cannot even carry one.
- Disclosure: a caller without access to the store (another store or another organization) or without membership in the organization gets 404; a caller who can see the record but may not change it (e.g. employee, manager editing a store) gets 403.
- Reads use the caller-scoped client, so the feature 02 RLS policies decide visibility; `status=archived|all` is only allowed for managers/admins and never widens RLS.
- The API also refuses early (403, no database call) when the caller administers no organization (admin routes) or manages no store (display routes).
- Verified by `tests/db/test/catalog-management.test.ts` and `tests/api/test/catalog.test.ts` with real signed-in admin, manager, employee and other-organization users (progress-tracker.md).

## Implementation (feature 05)
POG authoring, cloning, reference upload/finalization and publication are organization-admin only. API capability checks are followed by stored-resource authorization; trusted SQL functions re-check active membership and admin role. Reference byte upload and finalization check the active organization/admin **before** privileged Storage operations. Intents bind the exact draft, actor and path; expiry is enforced by the API (10 minutes) instead of issuing Supabase's fixed two-hour signed upload tokens. All client Storage object access remains denied; no public bucket or write policy is introduced.

Image access reads the version with a caller-scoped client first. Managers see published organization layouts; employees see only assigned/pinned layouts for their accessible stores. Historical pinned references remain accessible after reassignment. Five-minute signed links are not stored/logged; already-issued links can survive revocation until expiry. Tests use actual Auth identities for API/RPC/RLS/Storage denials and live-token membership revocation. Managers assign published layouts through the unchanged Feature 04 boundary, never author them.

## Implementation (feature 11)
History list (`GET /scans`), detail, review record (`GET /scans/:id/history`) and image access all start with the same caller-scoped read of `scans` (RLS: `accessible_store_ids`). Filters only narrow; a store/display/organization filter the caller cannot read is 404. Revoking a store assignment removes that store's scans from all four routes on the next request even with a live token (tested); revoking the organization membership gives 403. The service client is used only after that read, for the one visible scan: actor display names and analysis attempt versions, returned only to that store's managers and org admins (D75). Employees read their stores' history and records (matrix row "Read scan history") but the web dashboard remains managers/admins only; history routes are read-only.

## Implementation (feature 16)
- Public sign-up (`[auth] enable_signup = true`, `enable_confirmations = true`, 6-digit code template). A new account's `/me` is 403 until it redeems the access code; only `GET /onboarding` and `POST /onboarding/join` accept callers without a membership (`authenticateApi({allowWithoutMembership})`).
- The access code grants organization `member` only, never admin, and cannot restore a revoked membership or add a second organization. Attempts use the shared D83 windows (10/account, 50/client per 15 min). Codes live in a service-only table; audit metadata omits them.
- `onboarding_store` locks the organization row so two accounts creating the same number get one store with one manager; later accounts become employees. Store managers may edit name/timezone (`store_settings_update`) and choose display types; store number, archiving and type/PAR defaults stay admin-only. Anyone with the code can join any active store of the organization by number (owner decision D107).
- Hosted Supabase must mirror these Auth settings and the confirmation template before the app's sign-up works there.
