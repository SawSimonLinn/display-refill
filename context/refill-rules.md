# Refill Rules

## Authoritative Calculation
Use pinned slot target `t`, optional inclusive trigger `h`, and accepted count `c`.

```text
if c is unknown:
    refill = null; confirmation is blocked
else if h is null:
    refill = max(0, t - c)
else if c <= h:
    refill = max(0, t - c)
else:
    refill = 0
```

Null threshold means always top up. With a threshold, refill is triggered at or below it, not strictly below. Above-target counts are allowed and produce zero refill. All arithmetic occurs in the backend domain module and is recomputed at confirmation. Never use provider-returned targets or refill quantities. iOS displays server calculations; pending local edits show “Save to recalculate.”

## Examples
| Target | Threshold | Current | Refill | Meaning |
| --- | --- | --- | --- | --- |
| 3 | null | 2 | 1 | Top up |
| 3 | 1 | 2 | 0 | Above trigger |
| 3 | 1 | 1 | 2 | Inclusive trigger |
| 3 | 1 | 0 | 3 | Empty |
| 3 | 1 | 4 | 0 | Over target |
| 3 | 1 | unknown | unknown | Must verify |

Repeated products across slots are calculated per slot, then summed by product_id. Excess in one slot does not offset a shortage in another. A misplaced product is flagged for review, not automatically counted as the expected product or credited elsewhere.

## Effective Counts and Confirmation
During review, accepted_quantity is the most recent human count if provided, otherwise a validated AI estimate. An explicit verification is needed for every review_required slot, even when the value remains unchanged. Manual slots all start unknown and require entry. A known AI estimate can generate a provisional recommendation, but it cannot bypass required verification. The UI must label unresolved recommendations provisional.

Confirm locks the scan revision, checks every slot known and verified as required, writes final quantities and refill quantities, aggregates totals, stores the confirmation, and changes status atomically. Confirmation is immutable in MVP. Fix a confirmed mistake by creating a new scan/manual check; do not mutate historical confirmed counts.

## Optional Display Fill Score
Only show after all counts are resolved: `round(100 * sum(min(c,t)) / sum(t))`. Cap each slot separately before summing; overstock cannot mask an empty slot. Score is independent of refill trigger. If any count is unknown, score is null. Targets are positive, so zero denominator is rejected at publication. Do not label this food safety or merchandising compliance.

## Completion
Confirmed lists may be marked completed once. Completion records actor/time and does not change detected counts, target, fill score, or imply a new observation. Partial task tracking is deferred. Historical text says “7 items recommended; completion recorded,” not “7 items detected refilled.”


## Production workflow amendment
The scan rules above remain unchanged. Feature15’s Stock Check/Prep List is a separate inventory/preparation workflow: stock includes ready backup, combined shortage uses approved PAR snapshots without triggers, and prepared events reduce the current shortage until a new physical count includes them. See [Feature15](feature-specs/15-stock-check-shared-prep.md). Scan completion remains an attestation; prep records are actual reported production quantities.
