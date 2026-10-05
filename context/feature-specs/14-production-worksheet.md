# Production Worksheet — HAVE / MAKE

## Status
Implemented locally; focused verification passed, full accessibility/device acceptance pending. This is the owner-requested replacement for the daily employee entry flow; previous scan history remains intact.

## Confirmed product decisions
- Four ordered sections: Fruit mobile bunker, Salad mobile, Fruit display case, Veggie display case.
- HAVE includes display stock plus prepared backup stock in the cooler. Count each physical unit once; a product has one owning section per store.
- Employee UI shows product, HAVE and MAKE, never PAR or refill thresholds.
- MAKE = max(0, PAR - HAVE), calculated by backend. Blank HAVE means uncounted.
- Manager of the store and organization admin can configure product PAR independently of POG geometry. All PAR/count changes record actor/time and before/after values.
- PAR and product metadata are snapshotted when a check starts; changes apply to new checks, never silently change an existing check.
- Latest finished check per section in the store-local day supplies Need to make now. Never sum morning and afternoon shortages. Show missing/in-progress sections and each included check time; totals are recommendations, not actual production.
- Employee enters one section at a time without horizontal scrolling. Save during editing, with visible pending/error states; finish only after every row is counted and saved.
- Filter final list by section, category and product type; sort by MAKE quantity or name. Default show MAKE > 0.
- Photos are deferred. Legacy photo/manual checks remain historical features, not the default employee path.

## Data and permission boundary
Add independent production items, section checks, count snapshots and append-only edit events. Existing POG/scan functions retain their semantics. Use current Auth and store membership helpers; server-only writes validate stored tenant/store and enforce revisions/idempotency. Do not mutate published POG slots to change PAR. Employees cannot mutate configuration. New check counts allow 0–9999; PAR allows 0–9999. Totals are integer sellable packages.

## Acceptance
1. Four sections render in fixed order with numeric HAVE entry and next-row/next-section navigation at large text sizes.
2. Employee responses/screens omit PAR; blank/zero remain distinct.
3. Manager/admin can set PAR and see exact actor/time/before/after history; other stores and employees cannot do so.
4. Count autosave retries preserve edits and exact operation key; conflicts never overwrite unseen edits.
5. Two finished checks of the same section/day contribute only the latest. Partial coverage is explicitly labeled.
6. Existing manual/photo/history endpoints and tests are preserved.
7. No real store products/PAR inferred from the supplied screenshot; configuration requires approved input.

## Operational boundary
Local development only. No hosted operations, provider calls, database resets, or deployment. Do not remove the existing local test account.


## Local setup and verification
1. Apply local migrations 18–20 with `supabase migration up --local`; do not reset a retained device-test database.
2. Sign in to the admin dashboard as an organization admin or assigned store manager. Open `/production`, select the store, then PAR setup. Add existing catalog products once each, choose the owning section, category/type, PAR and order. New catalog products still require the existing admin Products page.
3. Employee Today reads the same assigned store. Count display plus prepared backup once per product. Saved drafts resume on the current store-local day. Finish each section to include it in the daily total. A PAR edit applies only to checks started afterward.
4. Four fixed sections are expected. A section without configured active products cannot finish and keeps coverage partial; optional section configuration is not implemented.

Focused checks: `npm run test:db -w @display-refill/db-tests -- test/production.test.ts test/catalog.test.ts`; `npm run test:api -- test/production.test.ts`; standard typecheck/lint/unit commands; `swift test` in DisplayRefillKit with full Xcode selected by DEVELOPER_DIR.

`ProductionWorkflowUITests` requires a temporary, ignored `apps/ios/Verification/ProductionFixture.json` with synthetic local email/password. The fixture expects a store with Synthetic Watermelon Bowl in fruit_mobile and Synthetic Cobb Salad in salad_mobile and approved synthetic targets. Generate the Xcode project after adding the fixture; run only that UI class against the local backend. Remove the fixture and regenerate afterward. No production credentials. Tests exercise default/largest text entry, save and next section; they do not establish spoken VoiceOver or full-day device acceptance.


## Owner-supplied morning catalog amendment (2026-10-04; supersedes single-owner rules above)
See `../pilot/morning-item-list/README.md`. FM-615 University Place now has108 local display rows representing103 exact-name products. Multiple sections may reference the same product. Those HAVE fields are display-only; shared cooler backup is entered once in the first section and subtracted once from the combined production need. Nonshared HAVE remains display plus backup. New counts are blank; old sheet counts were not imported. Section ordering remains fruit mobile, salad mobile, fruit case, veggie case. Staff identity/time is recorded by authenticated saves.

Count requests optionally include backup (integer0–9999 or null), only for backup_required rows. Check/day items add shared_size, backup_required and backup. Shared check MAKE is null until daily reconciliation; day responses exclude unresolved shared groups from the partial total. Shared membership is snapshotted and cannot change mid-day after a group starts. Existing final checks are untouched. Names/price/size labels preserved; package types were not guessed from images.


## Ongoing shared-prep amendment (2026-10-05)
[Feature15](15-stock-check-shared-prep.md) supersedes the daily employee MAKE summary with rolling grouped prep, partial production records and atomic per-product stock updates. Full section entry/PAR configuration and snapshot history remain. The old day endpoint is compatibility/status information; current remaining work comes from the prep endpoint.
