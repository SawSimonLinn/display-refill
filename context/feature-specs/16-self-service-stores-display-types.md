# Self-service Stores and Display Case Types

## Status
Units 1–4 implemented and verified locally on 2026-10-07 (progress-tracker.md). Not yet applied to the hosted project: migrations `20261007000400`/`0500`, the Auth sign-up/confirmation settings and template, the admin deployment and a new TestFlight build are all still pending. No physical-device or spoken-accessibility check of the new iOS screens.

## Owner decisions (2026-10-07)
- Anyone can create an account with email and password in the app. The account sees nothing until it enters the organization's **access code**, which an admin creates, shares, rotates or turns off.
- After joining, the user enters a store number. If the number is new in the organization, they give the store name and timezone, the store is created and they become its **manager**. If the number already exists, they join that store as an **employee**, so coworkers share Stock Check, Prep List and Waste Log.
- The store manager picks which **display case types** their store has. Types are an admin-managed organization list (today: M1 bunker, Salad destination, 6ft fruit, Veggie display case).
- Admin owns each type's product list, default PAR and POG. A store manager may override PAR for their own store; admin PAR changes still reach every store that has not overridden that item.
- The four current sections become the first four types with their products, PAR and POGs. FM-615 University Place selects all four, so nothing changes for current staff.

## Units
1. **Display case types (database).** `display_types`, `display_type_items` (product, default PAR, category, type, order), `store_display_types`. `production_items` gains `template_item_id` and `par_overridden`. Hard-coded section lists in production/prep/waste/POG functions become the store's selected types in type order. Waste family comes from the type. Convert the four sections and backfill existing stores. Admin template edits propagate to selecting stores; selecting a type copies its items; removing one deactivates its items.
2. **Access code and onboarding (database + API).** Service-only `organization_access_codes`; `POST /onboarding/join` (rate limited, generic failure), `POST /onboarding/store` (create-or-join by number), `GET /display-types`, `PUT /stores/:id/display-types` (manager), admin `GET/POST /access-code`. Supabase public sign-up enabled with email confirmation by 6-digit code.
3. **Admin dashboard.** Display Types page (types, items, default PAR, POG kind), Access Code page, store type selection and per-store PAR override/reset on the existing PAR setup.
4. **iOS.** Sign-up and email code entry, access code, create/join store, pick display types; Stock Check sections come from the server instead of the fixed Swift enum.

## Permission changes
| Action | Employee | Manager | Admin |
| --- | --- | --- | --- |
| Join organization with access code | Any signed-in account without membership | — | — |
| Create store during onboarding | Becomes its manager | — | Organization |
| Edit own store name/timezone | No | Assigned stores | Organization |
| Select store display case types | No | Assigned stores | Organization |
| Edit display types, default PAR, POGs | No | No | Organization |
| Override/reset store PAR | No | Assigned stores | Organization |
| View/rotate access code | No | No | Organization |

## Acceptance
1. Existing FM-615 counts, prep, waste and history are unchanged after migration; all existing database, API and Swift tests pass.
2. A new type added by an admin appears for selection; once selected, Stock Check shows it in type order and prep/waste include it.
3. Admin default PAR change reaches non-overridden stores only; checks already started keep their snapshot.
4. Wrong, disabled or rotated codes fail with the same message and are rate limited; a code never grants admin or another organization.
5. Two accounts entering the same store number share one store; only the first is manager.
6. Store, type and PAR changes are audited with actor and before/after values.

## Not included
Billing, multiple organizations per account, store deletion, manager approval of joiners, and per-store POG editing.
