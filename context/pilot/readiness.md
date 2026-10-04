# One-store, one-display pilot readiness

Prepared 2026-10-03. **Preparation in progress; release blocked. Real vision unverified.** This packet contains procedures and empty evidence forms, not pilot results. The owner-selected Mobile #1 POG is now preserved locally with a draft seven-lane table in [mobile-1-draft.md](mobile-1-draft.md). No actual store, approved stocking quantities, real-photo dataset or provider credentials have been supplied. Owner selected manual/local mock for now; no real provider execution authorized. Read with [acceptance](../testing-and-acceptance.md), [vision](../vision-contract.md), [retention](../storage-and-retention.md) and [operations](../operations-runbook.md).

## Evidence-based inspection of Features 01–12

Historical results below are recorded in [progress tracker](../progress-tracker.md); current-session reruns are recorded separately there. A source implementation or passing mock test does not establish physical-device or real-provider behavior.

| Feature | Implemented/source inspected | Verified evidence already recorded | Outstanding pilot gate |
| --- | --- | --- | --- |
| 01 | npm workspaces, server config, iOS target; package.json, config.ts, project.yml | TS builds/config secrecy; signed simulator builds in 07 | Store device/OS compatibility and signing |
| 02 | migrations 01–17, RLS, immutable snapshots, tenant constraints | Fresh local migrations; role/Storage/concurrency negative tests | Same security checks on authorized release environment |
| 03 | server auth/members, native SessionManager/SessionStore | Local API auth/revocation; simulator Keychain relaunch/logout | Hosted invite/reset/SMTP; physical refresh/logout |
| 04 | server catalog.ts and management web routes | Local DB/API plus Chromium management/conflict checks | Actual store/products/display and operator approval |
| 05 | pogs.ts/pog-images.ts, editor, immutable publication | Local reference normalization, publication/clone/assignment and keyboard/numeric checks | Approved actual POG; spoken web accessibility |
| 06 | domain refill rules, scans.ts, transactional confirmation | Arithmetic/unknown/inclusive trigger/aggregation/concurrency/frozen history | Employee uses approved quantities; no stocking targets inferred from photos |
| 07 | ManualWorkflow/ManualCheckView | Signed default/largest-text simulator flows, retry/relaunch/completion/logout | Physical iPhone; spoken VoiceOver; unaided employee run |
| 08 | PhotoImage/PhotoWorkflow/PhotoCheckView, photo-scans.ts | Local upload/security tests; simulator import/crop/finalize after A05 fix | Camera permission/capture, HEIC/orientation, interrupted uploads/background on iPhone |
| 09 | vision.ts, pipeline.ts, queue.ts, durable job RPCs | Synthetic validation, retry, fencing, takeover and simulator polling | Real adapter, data approval and held-out benchmark |
| 10 | ReviewWorkflow, append-only correction RPCs | Mock review/correction/verification/conflict/confirmation API + simulator | Real outputs, human hidden-stock checking, spoken/device review |
| 11 | scan-history.ts, HistoryView, web records | Local authorization/pagination/deleted image tests; simulator/Chromium | Physical history links, spoken native/web screen reader |
| 12 | operations migration, retention.ts, metrics/shared limits | Synthetic cleanup/retry/fencing/privacy + local restart; documented runbook | Approved retention/backups; independent-host drills, alert delivery, rollback and full restore |

## Configuration worksheet (operator must fill and sign)

Record organization ID, store ID/number/name/IANA timezone; display ID/name/location; owner and support contact; authorized admin, store manager and employee memberships. Use one active display; keep synthetic seed organizations separate. Record employee iPhone model/OS, signing team, API/Supabase public endpoints and network access. Never place service keys in iOS or worksheets.

Record actual product IDs, names/short names, category, container type and identifying SKU/PLU/UPC where available. Confirm what constitutes **one unit** (e.g. one sellable container), product variants and handling of misplaced items. No guessed product identities.

For each slot complete `configuration.csv`: unique label/order, expected product ID, canonical upright crop rectangle (x,y,width,height in [0,1], no overlap), positive integer target <=999, nullable inclusive trigger (`refill_threshold`, 0 through target), and hidden-stock check instructions. Null trigger means always top up; trigger means refill only at accepted count <= trigger. Repeated products remain separate slots before aggregation. **Reference photographs establish geometry/identity only, never approved targets or triggers.** Obtain operator approval with date and source (approved merchandising instruction or explicit owner decision).

Locally prepare draft only after actual data is supplied; validate reference, inspect every rectangle, publish immutable v1, assign to display and record IDs/revisions/reference hash and approval. Test null/equal/above-trigger/zero/over-target cases against the owner worksheet. Publish/assign v2 during the acceptance scenario and prove old scans retain v1. No hosted writes are authorized by this packet.

## Photo collection and ground truth

1. Obtain approval for capture, local storage, people avoidance and any later external processing; approval must include the **reference photo** as well as scan photos. Keep private files outside git with restricted access. Strip location/EXIF, use opaque IDs/checksums; no people, badges or customer details in frames. Retake if these appear. Define local dataset deletion and backup expiry before collecting.
2. Collect 30–50 development photos across actual fullness, light/glare, angles, cropped edges, wrong products and container arrangements. Include empty and full slots and hidden layers. Capture at least 20 additional held-out photos in different sessions; split by session/arrangement to prevent near-duplicate leakage. Hash and freeze manifest before tuning; evaluators keep held-out labels from prompt developers. Record strata and failures, not only attractive photos.
3. Two humans independently label each slot at capture time, without model output. Record visible attributable count, countable yes/no, physical total after inspecting behind/under units, hidden units, expected/wrong product and quality flags. Avoid changing the scene between photo and count; otherwise mark invalid and recapture with reason. Reconcile disagreements and sign/date the agreed label. Unreconciled labels cannot enter scored accuracy; report excluded denominator explicitly.
4. For hidden stock, visible count and physical total are separate truths. Do not score a visible estimate against physical total as ordinary image accuracy. Require occlusion/unknown/review and a physical check before accepted total/confirmation. A confidently accepted visible count can understate total even when visible counting is correct: record this as a hidden-stock workflow failure. Do not infer rear units from typical stacking or reference fullness.
5. Tune only on development data; freeze adapter/model snapshot, prompt/schema/review policy, image processing and pricing version before the held-out run. Run once per frozen candidate, retaining failures. If held-out results guide revisions, retire that set to development and collect a new held-out set. No correction ledger is automatically ground truth or training data.

## Benchmark/report definitions

All figures are **not measured** until a real approved run exists. Use `photos.csv`, `observations.csv`, `runs.csv` and `report.md`. Report separately per display and split, with photo/session counts and slot denominators. Do not pool away difficult strata. Retain initial AI evidence separately from normalized, accepted and final values.

| Metric | Exact definition |
| --- | --- |
| Exact count accuracy (release target >=85%) | Correct normalized pre-human visible counts / all reconciled countable held-out slot observations. Null/missing/failure predictions on countable slots count as non-exact. Also report accuracy among known predictions as a secondary figure, with coverage. Never use corrected counts as model accuracy |
| Unknown rate | Normalized null quantities / all pinned slot observations. Include missing IDs, quality normalization and whole-request failures as unavailable/unknown for evaluation; distinguish these from database stored observations. Report countable vs noncountable/hidden strata |
| High-confidence error | Incorrect visible counts / known raw predictions with confidence >=0.80 on reconciled countable slots. Also report incorrect normalized non-review predictions / all normalized non-review known predictions; show flagged raw high-confidence mistakes separately. Confidence is uncalibrated. Zero denominator => N/A |
| Correction rate | Distinct slots where final human count differs from initial AI known count / reviewed slots with initial known count. Separate visible count fixes from hidden-unit additions and wrong-product fixes. Report unknown resolution / initial unknown slots; unchanged explicit verification separately. Repeated saves are not additional corrected slots |
| Hidden-stock safety | Slots needing physical inspection; proportion routed to review; unknowns resolved only after physical check; unsafe confirmation attempts/accepted totals. Hidden totals are not image accuracy. Any unknown silently zero-filled or unverified hidden total is a blocker |
| Latency | Queued-at to review-ready-at (queue + download + provider + persistence) per successful scan, median/p95 nearest-rank ceil(.95*n). Separately capture capture-to-confirm, provider-attempt latency, upload and retries/timeouts/failures. Failed scans excluded from success percentiles but reported explicitly. Target p95 <15 s is provisional |
| Employee time | Start display selection to successful confirmation, median over unaided completed tasks; separately time physical refill/completion. Report staff/task counts, failed/abandoned tasks and developer interventions. Provisional median <30 s |
| Cost | Sum all billed attempts (including failed/retried/cancelled/fenced calls) / submitted scans; also per successful scan. Record tokens/images/cache/other billable units, dated rates/currency, estimated vs invoice totals and missing usage. Missing cost is N/A, never zero. Mock cost is synthetic, excluded |
| Reliability | Failed scans/submissions, retrying scans/submissions, manual-mode scans/all scans, provider attempts/outcomes and upload retries; explain denominators |

Operational aggregates are useful diagnostics, not this benchmark: `operations_metrics` does not join human ground truth or split datasets; attempt latency is not employee time, and recorded usage may omit externally billed aborted calls. Offline report reconciliation is required. Report confidence intervals or at least sample sizes and clustering by photo/session; 20 photos is pilot evidence, not generalization to other displays.

## Blocking release checklist

- [ ] Operator approved actual catalog, units, POG slots, targets/triggers and reference.
- [ ] Photo use and provider data handling approved; provider/model/prompt locked and held-out benchmark measured (or manual-only scope explicitly approved).
- [ ] Real iPhone and spoken native/web accessibility checks in `device-accessibility.md` pass with artifacts.
- [ ] Employees complete manual and approved photo workflows without developer intervention; all unknowns/hidden stock physically resolved.
- [ ] All seven full pilot scenario steps in testing-and-acceptance.md demonstrated in authorized environment, including v1/v2 history and revocation/image denial.
- [ ] Security/arithmetic/uncertainty/fencing/history/manual fallback blockers cleared. **A06 remains open**: capture reset/build/harness/server logs on recurrence; diagnose/map error and prove fix. A passing subsequent run alone does not close it.
- [ ] Hosting/auth/SMTP/proxy/fleet budget/support selected; independent-host outage/restart, monitor alert delivery, rollback and DB + private Storage restore rehearsed.
- [ ] Image/metadata/audit/abandoned-upload/provider/dataset/backup retention approved and enforceable. Metadata expiry is currently unimplemented; approving 12 months alone does not enforce it.
- [ ] Authorized distribution and support instructions recorded; controlled TestFlight install/run demonstrated. No build distribution authorized yet.

If vision misses target, record failed metrics and propose **manual-only pilot, photo analysis unvalidated**. Manual-only still requires device/accessibility/security/recovery/configuration/data-policy gates and explicit release authorization. Five/six-layout expansion requires new per-display evidence. Feature 13 and MVP remain incomplete.
