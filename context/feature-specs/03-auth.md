# Supabase Authentication and Memberships

## Status
Not started.

## Dependencies
Feature(s): 02. Read the linked domain contracts through the README before implementation.

## Goal and Scope
Implement email/password login, password reset, invite acceptance, session refresh and logout on web/iOS using Supabase Auth. Disable public signup. Admin-only membership management assigns organization and store roles, prevents removing the final admin, and audits changes. Bootstrap the first admin through an operator procedure. Web access uses verified SSR sessions; mobile uses bearer access tokens and secure refresh-token persistence. Admin/manager can enter dashboard according to capability; employees use iOS and cannot open management pages.

## Acceptance Criteria
- Invited user signs in on both clients and sees only authorized stores.
- Expired token refresh works once; invalid refresh returns to sign-in without retry loops.
- Password reset works through allowlisted redirects; arbitrary redirect values are rejected.
- Logout clears sensitive cached content; revoked membership denies next request.
- An employee cannot grant themselves manager/admin through API or direct DB writes.
- No alternative identity provider is installed or referenced as an implementation dependency.

## Verification and Handoff
Run relevant unit/integration/client tests from testing-and-acceptance.md, including authorization and failure paths. Record actual commands, observed results and unverified environments in progress-tracker.md. Update contracts when implementation decisions change. Do not mark complete until the criteria above are demonstrated.
