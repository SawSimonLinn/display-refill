# Waste Log and made/waste reporting

## Agreed scope

Replace the employee Saved checks tab with Waste Log; keep existing scan data and the History tab. Stock Check’s section landing page shows today’s containers made and wasted, with a report link. The web home dashboard replaces the development build-status list with store-scoped daily, Sunday–Saturday weekly and calendar-month reports. Default product order is fruit first, starting with $5 bowls. Group and most-made/most-wasted filters support comparison.

The user explicitly chose **track made and waste first; add sales later**. Made minus waste is not sales. No best-selling ranking or sales estimate is generated. No sample values from the screenshot are imported as real waste.

## Records and calculations

- Quantities are whole finished sellable packages/containers (1–9999 per entry), using existing product identities. Different package sizes remain distinct products; the same product across mobile/display locations is listed once.
- Waste requires product, quantity, reason (`expired`, `quality`, `damaged`, `other`) and business date; optional note is at most 300 characters. UI defaults to the store’s current date; historical dates are supported. Future dates are rejected.
- Events capture actor, actual recording time, chosen store-local business date and product-name/category/type snapshots.
- Undo appends a reversal referencing the original. Owners can undo their entries; managers/admins can undo any entry in their authorized store. Another employee cannot undo somebody else’s entry. Originals and reversals cannot be edited or deleted.
- Retries use the same persisted request body and idempotency key. Same-key/different-body is a conflict. Store locking and unique reversal references protect concurrent requests.
- Made totals sum `production_prep_events.quantity` by actual recording timestamp in the store timezone. Waste totals sum entries minus reversals by business date. Reversals apply to the original date, rather than manufacturing new waste on the undo date.
- Recording waste does not adjust HAVE, confirmed scan snapshots or prep events. Staff update Stock Check after discarding stock. No automatic stock reconciliation is inferred from a waste entry.
- Read reports include up to 200 recent original waste entries with undone status; totals include every entry in the selected period. Product names on aggregated reports are current catalog names. Waste log names are snapshots. Only existing recorded production can be reported; earlier unrecorded preparation is not backfilled.

## Backend and clients

Migration `20261005002900_waste_and_operations.sql` adds the ledger, organization/date indexes, RLS, append-only/valid-reversal guards, and server-only reporting/record functions. Every function rechecks stored memberships and organization/store/product scope. Supabase Auth remains the identity source; no Clerk.

- `GET /api/v1/operations/:store_id?period=day|week|month&day=YYYY-MM-DD`: authorized report, default today/day. Dates/ranges use the stored store timezone. Unknown query fields and future dates fail validation.
- `POST /api/v1/waste/:store_id`, `Idempotency-Key` required:
  - `{action:"record",product_id,quantity,reason,note?,business_date?}`
  - `{action:"void",entry_id}`
- Employee API responses do not expose PAR. Role values/actor/organization IDs from request bodies are refused.
- iOS keeps a store/user-scoped interrupted operation across relaunch; uncertain saves lock further entry until retry resolves it. Product search, numeric keyboard, date/reason/note, retry/error states and confirmation before undo are provided. The home summary and log refresh while active.
- Dashboard provides store, date, period, group and order selectors; loading, empty and retry states; made/waste totals and recent waste history.

## Verification gates

Prove same-key concurrency is exactly once; no direct browser table/RPC access or actor spoofing; store/organization isolation; immediate revocation; owner/manager undo rules; immutable original snapshots; no prep-ledger changes when logging waste; date boundaries and Sunday/calendar-month aggregation; no PAR disclosure. Native verification covers record, summary, relaunch and undo at normal/largest text sizes. Preserve existing stock/prep workflows and the Build Book tab.

Physical-phone interaction, spoken VoiceOver, complete historical data import, operational reporting accuracy with real staff data and sales integration remain separate verification tasks. See progress tracker for actual checks and evidence.
