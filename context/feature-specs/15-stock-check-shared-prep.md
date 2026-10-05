# Stock Check and Shared Prep List

## Status
Implemented and verified locally:5/5 focused simulator workflows,111 API tests,166 database tests,137 TypeScript tests and69 passing host Swift tests with5 opt-in skips. Physical-device, spoken accessibility, multi-phone LAN and hosted acceptance remain open. See progress-tracker.md for final evidence rather than inferring acceptance from source files.

## Owner-authorized workflow
- Stock Check keeps the four sections in order: fruit mobile bunker, salad mobile, fruit display case, veggie display case. Enter whole sellable-container counts with number-pad and keyboard Next. Employees do not receive PAR.
- A full section count starts blank and is published only when every count and required shared backup is saved. Autosave saves the draft; Finish publishes it.
- During the day, Update a product allows a new physical count of just that product. All its locations and shared backup are submitted together. No need to re-enter the other products in a section.
- Prep List groups by product identity/package, never fuzzy name similarity. One row shows the combined amount remaining. Location details use M for mobile and D for display, with the full section name.
- Record made adds finished ready-to-sell containers, including those still in the prep room. Need25/made20 leaves5. Done records all remaining after an explicit confirmation. Neither action replaces a physical stock count.
- The next employee sees the server result and recent actor/time/quantity records. Filter by category/type, sort by remaining quantity or name, and optionally show completed products.
- iOS and the admin prep monitor refresh every5 seconds while open/visible. Show update time and connection errors. Sales enter the calculation when staff recount; there is no POS integration.
- Stock and prep carry forward across midnight until replaced; dated count times are visible. A morning recount remains an operational requirement, not an automatic midnight reset.
- Manager/admin PAR controls and edit history remain in the web dashboard. Changes apply to newly started counts, not prior snapshots.

## Inventory accounting
For one product, baselineNeed=max(0,sum(PAR snapshots)-sum(display stock)-shared backup). For a product in one section, HAVE already includes its backup. Shared backup is recorded once in the first configured section.

remaining=max(0,baselineNeed-sum(prep events after the count baseline)). A new physical count includes previously prepared containers; its prep baseline advances, so those events are not subtracted twice. Moving containers to a display is a stock transfer, not another prep event.

A new shared full-section count uses a stock round. The product remains unavailable for prep until all its locations have matching stock rounds and preparation baselines. An atomic product recount publishes every location together. If preparation occurs during counting, or another newer count is published, an older full-section draft cannot finish; staff explicitly start a fresh count. Abandoned drafts and prior counts remain immutable evidence.

## Server and retry boundary
Store membership is reread on every request, including idempotent replay. All writes serialize on the store lock. Product revisions cover included count identities plus the latest prep sequence; stale concurrent writes return409. Prepared events are append-only and contain actor/time/quantity.

Interrupted iOS prep and product-stock operations retain their payload/key in user-and-store-scoped local persistence. Exact retries retrieve the same outcome. A409 refreshes or requires a fresh physical recount rather than automatically replaying a changed amount. Slow background reads cannot disable prep buttons or overwrite newer write results.

Service-only functions: production_prep_read, production_prep_record, production_stock_record, production_restart. Direct authenticated/anonymous table/RPC access is refused. Supabase Auth remains the identity system.

## Local verification and limits
API tests cover25→20→5, Done, replay, concurrency, invalid input, shared baseline/round transitions, stock transfers, older draft rejection and live revocation. Database tests cover RLS/grants, scoped foreign keys and indexes. Swift tests cover interrupted writes/relaunch, conflicts, input validation and refresh/write ordering. Simulator tests cover stock entry, partial prep, Done, saved results after relaunch and quick product updates at largest text size.

This unit adds no real vision provider, photo transfers, hosted migration, production schedule, stock undo, waste/POS feed or automatic physical inventory detection. Preparation amounts currently must be1…9999 and cannot exceed the displayed remaining amount; any overproduction must be reflected in the next physical stock count. History is limited to the five most recent prep events per product in the employee view. Admin stock/PAR edit history retains the existing100-event view.

## Owner simplification — 2026-10-05
Supersedes the separate cooler-entry UI described above: Stock Check has one HAVE input per item and a read-only TO MAKE value for that section. A saved HAVE returns max(0, PAR snapshot - HAVE) even for a product also in another section; no “After both sections” placeholder. The number updates after the250ms autosave/server response, rather than being locally guessed from hidden PAR. Blank remains unknown. Prep still combines products and retains its existing completeness/concurrency safeguards. No separate cooler field is displayed in full-section or quick product entry; the existing API-compatible backup field is sent as0 for new app saves. Historical backup records and immutable finished scans are preserved. Staff count display containers; cooler contents are not automatically detected. Manager PAR controls remain unchanged.

## Owner fruit/salad organization — 2026-10-05
SALAD DESTINATION uses nine entries in order: FAMLY SIZED COBB2, FAMILY SIZED GARDEN2, FAMILY BLT2, COBB5, GARDEN5, BERRY2, CEASER3, SOUTHWEST3, BLT2 (numbers are manager-only PAR). The final BLT entry was provided at the tail of the owner’s table; no product removed.
6FT FRUIT has51 entries in five configured categories: Top row12 (STRAWBERRY & WHIPPED TOPPING through WHIP TOPPING),2 for6 eleven (WATERMELON CUP through PINEAPPLE SPEARS),$5 bowls14,$10 bowls7,Party tray7. Owner confirmed that slices, quarters and both60oz containers stay with Party tray. Category headings come from the pinned item category, retain item order, and leave keyboard Next continuous across groups. Manager catalog categories and Prep List filters use the same metadata. Existing drafts/history keep their snapshots; fresh counts see new categories. Owner HAVE examples are not imported.
