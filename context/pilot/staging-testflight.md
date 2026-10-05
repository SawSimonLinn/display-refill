# Hosted staging and TestFlight pilot

Prepared 2026-10-05. This is the path for testing a different iPhone at a different store, away from the Mac. The local LAN setup is not enough for that situation because the phone cannot reach `localhost` or the Mac's private backend unless it is on the same trusted network.

The first remote pilot should be **manual-only**: Stock Check, Prep List, Build Book, Waste Log and made/waste reports. Photo analysis remains disabled until a provider, data policy and benchmark are approved.

## Goal

Run one real store on a hosted staging environment:

- Hosted Supabase Auth/Postgres/Storage.
- Hosted Next.js admin/API.
- Optional worker deployed but with real vision disabled.
- iOS build distributed through TestFlight.
- Real employee/manager accounts assigned to one store.
- Real PAR values managed by manager/admin only.
- Employees enter HAVE by section; Prep List groups what to make; Waste Log tracks discarded sellable containers.

## Why staging first

Staging lets a phone anywhere sign in and use the app without being near the Mac. It also keeps the first remote test away from final production data while we confirm:

- Login/invite/password reset works with real email.
- Store assignment is correct.
- The iPhone build points to the hosted API and hosted Supabase.
- Stock, prep and waste writes persist for multiple users.
- Managers can adjust PAR without employees seeing PAR.
- Reports show made and waste, not sales.

## Required accounts and decisions

Before deployment, collect these values in a private operator note. Do not commit secrets.

| Area | Required value |
| --- | --- |
| Supabase | Staging project URL, publishable key, service-role key, database connection string |
| Admin/API host | Public staging URL, deployment project, environment variable editor access |
| Email | SMTP provider or Supabase email setup for invites and password resets |
| Apple | Apple Developer team, bundle identifier, App Store Connect app, tester Apple IDs |
| Store | Store name/number, timezone, manager emails, employee emails |
| Data | Approved product list, PAR values, waste reasons, initial section/category order |
| Policy | Manual-only first test, no external photo provider, no real customer/person photos |

Use separate staging and production projects. Do not point TestFlight at the Mac local backend.

## Staging Supabase setup

1. Create a new Supabase project named clearly as staging.
2. Configure Auth:
   - Disable public signup.
   - Enable email/password.
   - Use the hosted admin URL as the Site URL.
   - Allow redirect only to `<admin staging URL>/auth/confirm`.
   - Set minimum password length to 12.
   - Enable refresh-token rotation.
   - Configure real SMTP before inviting store employees.
3. Apply migrations to staging only after a local passing check.
4. Generate types from the staging schema after migration, but do not overwrite local evidence unless the schema is expected to match.
5. Run `scripts/bootstrap-admin.mjs` with the staging project URL and `--confirm-remote`.
6. Sign in as the first admin, create/import the real store and memberships, and verify employees see only their assigned store.

Do not run destructive reset commands against staging.

## Admin/API hosting

Deploy the Next.js admin/API with these environment values:

```text
NEXT_PUBLIC_SUPABASE_URL=<staging Supabase URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
SUPABASE_URL=<staging Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<staging service role key>
APP_ORIGIN=<admin staging URL, origin only>
LOG_LEVEL=info
```

The public values are safe for browser/iOS. The service role key stays server-only.

After deploy:

1. Open `/api/v1/health`.
2. Sign in through the admin page.
3. Invite one manager and one employee.
4. Verify employee web access is denied with the "use the iPhone app" page.
5. Confirm API responses never expose service keys, PAR to employees, or another store's records.

## Worker and photo analysis

For the first remote store test, keep real photo analysis disabled.

Recommended staging worker posture:

- Deploy the worker only if needed for cleanup/operational rehearsal.
- Use `VISION_PROVIDER=mock` only for explicit synthetic tests.
- Do not configure real provider credentials yet.
- Keep the database vision switch disabled for store users.
- Do not schedule retention cleanup until the retention policy is approved.

Manual Stock Check, Prep List, Build Book and Waste Log do not require a vision provider.

## TestFlight build

Create a staging iOS build with only public values:

```text
API_BASE_URL = https:/$()/<admin staging host>
SUPABASE_URL = https:/$()/<staging Supabase host>
SUPABASE_PUBLISHABLE_KEY = <staging publishable key>
```

Use the existing bundle identifier if it is available in App Store Connect. If the current bundle was only for local signing, create/register the production-style bundle identifier before archiving.

Build steps:

1. Generate the Xcode project from `apps/ios/project.yml`.
2. Archive the `DisplayRefill` scheme in Release.
3. Upload to App Store Connect.
4. Add the remote phone users as internal or external TestFlight testers.
5. Wait for Apple processing/review as required.
6. Ask the tester to install TestFlight and then Display Refill.

Record build number, bundle identifier, backend URL, Supabase project, tester email and install date in the progress tracker.

## First remote-store script

Use one store and one small group of testers first.

1. Manager signs into admin dashboard and confirms store/product/PAR list.
2. Employee signs into iPhone app.
3. Employee opens Stock Check and enters HAVE for:
   - M. M1 Bunker.
   - Salad Destination.
   - D. 6ft Fruit.
   - Veggie case.
4. Prep List updates and groups duplicate products into one line.
5. Employee records a partial made amount.
6. Another employee signs in on a different phone and sees the updated remaining amount.
7. Employee records waste for at least one item, then undoes one waste entry.
8. Manager opens dashboard and verifies made/waste totals for day, week and month.
9. Employee logs out and signs back in.
10. Manager revokes the employee membership and verifies the next app request is denied.

Do not test real photo analysis in this run. If staff take photos for later analysis, store them under the approved photo policy outside the app workflow.

## Acceptance for this stage

The staging/TestFlight pilot is ready to expand only when:

- A remote phone installs through TestFlight and logs in.
- Employee sees the correct store only.
- Stock Check saves real section counts.
- Prep List updates for another signed-in device.
- Waste Log records and undo work.
- Dashboard made/waste reports match the recorded events.
- Manager/admin can edit PAR; employee cannot see or change PAR.
- No photo provider is called.
- Any failure has logs, time, user, store and request details recorded.

Passing this stage does not mean final production launch. It means the manual workflow is proven away from the Mac.
