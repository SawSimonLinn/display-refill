"use client";

import { findFreeSpot, type LayoutIssue, type LayoutSlot, layoutIssues, type PogSlotInput, type PogVersionDetail, type Rect } from "@display-refill/domain";
import { CircleAlert, CircleCheck, Plus, Save, Send, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type ApiFailure, apiRequest } from "@/lib/api-client";
import { FailureNotice } from "../catalog/form-kit";
import { formatPercent, PercentField, PlainField } from "./fields";
import { ReferenceUpload } from "./reference-upload";
import { type CanvasRect, SlotCanvas } from "./slot-canvas";

export interface ProductOption {
  product_id: string;
  name: string;
  short_name: string;
  active: boolean;
}

/** One slot as edited: numbers the user types stay text until they are saved. */
interface EditorSlot extends Rect {
  key: string;
  slot_id?: string;
  label: string;
  product_id: string;
  target: string;
  threshold: string;
  sort_order: string;
}

const fromDetail = (detail: PogVersionDetail): EditorSlot[] =>
  detail.slots.map((s) => ({
    key: s.slot_id,
    slot_id: s.slot_id,
    label: s.label,
    product_id: s.product_id,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    target: String(s.target_quantity),
    threshold: s.refill_threshold === null ? "" : String(s.refill_threshold),
    sort_order: String(s.sort_order),
  }));

const wholeOrNaN = (text: string) => (/^\s*\d+\s*$/.test(text) ? Number(text) : Number.NaN);
const wholeOrNull = (text: string) => (text.trim() === "" ? null : wholeOrNaN(text));

function toPayload(slots: EditorSlot[]): PogSlotInput[] {
  return slots.map((s) => ({
    ...(s.slot_id ? { slot_id: s.slot_id } : {}),
    label: s.label.trim(),
    product_id: s.product_id,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    target_quantity: wholeOrNaN(s.target),
    refill_threshold: wholeOrNull(s.threshold),
    sort_order: wholeOrNaN(s.sort_order),
  }));
}

/** Stable comparison of what would be saved (keys and text formatting ignored). */
const fingerprint = (slots: EditorSlot[]) => JSON.stringify(toPayload(slots).map((slot) => ({ ...slot, slot_id: undefined })));

const pct = (v: number) => `${formatPercent(v)} %`;

// Unsaved layouts survive a reload or a sign-in in this tab (sessionStorage),
// so an expired session or a failed request never loses an hour of drawing.
const storageKey = (versionId: string) => `pog-editor:${versionId}`;
const noopSubscribe = () => () => {};
function readStored(versionId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(versionId));
  } catch {
    return null;
  }
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "conflict" }
  | { kind: "failed"; failure: ApiFailure };

/**
 * Draft editor: reference image, rectangle canvas, per-slot fields, explicit
 * save with revision protection, and publication.
 */
export function PogEditor({ detail, imageUrl, products }: { detail: PogVersionDetail; imageUrl: string | null; products: ProductOption[] }) {
  const router = useRouter();
  const liveId = useId();
  const [saved, setSaved] = useState(detail);
  const [slots, setSlots] = useState<EditorSlot[]>(() => fromDetail(detail));
  const [invalidCoordinates, setInvalidCoordinates] = useState<Record<string, boolean>>({});
  const numericInvalid = Object.values(invalidCoordinates).some(Boolean);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [publishing, setPublishing] = useState(false);
  const [publishFailure, setPublishFailure] = useState<ApiFailure | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const counter = useRef(0);
  const saveKey = useRef<{ request: string; key: string } | null>(null);
  const publishKey = useRef<{ revision: number; key: string } | null>(null);

  const productsById = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const activeProducts = products.filter((p) => p.active);
  const dirty = fingerprint(slots) !== fingerprint(fromDetail(saved));
  const hasReference = saved.reference !== null;
  const aspect = saved.reference ? saved.reference.width / saved.reference.height : 4 / 3;

  const layout: LayoutSlot[] = slots.map((s) => ({
    key: s.key,
    label: s.label,
    product_id: s.product_id || null,
    product_active: productsById.get(s.product_id)?.active ?? false,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    target_quantity: Number.isNaN(wholeOrNaN(s.target)) ? null : wholeOrNaN(s.target),
    refill_threshold: wholeOrNull(s.threshold),
  }));
  const issues = layoutIssues(layout, { hasReference, needsReview: saved.slots_need_review });
  const saveBlockers = issues.filter((i) => i.blocks === "save");
  const sortIssues = slots.filter((s) => {
    const n = wholeOrNaN(s.sort_order);
    return !(n >= 0 && n <= 999);
  });
  const issueKeys = new Set(issues.flatMap((i) => i.slot_keys).concat(sortIssues.map((s) => s.key)));
  const selectedSlot = slots.find((s) => s.key === selected) ?? null;
  const issuesFor = (key: string) => issues.filter((i) => i.slot_keys.includes(key));

  // Restore an unsaved layout kept in this tab, if it was based on this revision.
  const stored = useSyncExternalStore(noopSubscribe, () => readStored(detail.pog_version_id), () => null);
  const restorable = useMemo(() => {
    if (!stored || restoreDismissed) return null;
    try {
      const value = JSON.parse(stored) as { revision: number; slots: EditorSlot[] };
      return value.revision === detail.revision && fingerprint(value.slots) !== fingerprint(fromDetail(detail)) ? value.slots : null;
    } catch {
      return null;
    }
  }, [stored, restoreDismissed, detail]);

  useEffect(() => {
    if (restorable && !restoreDismissed) return;
    try {
      if (dirty) window.sessionStorage.setItem(storageKey(saved.pog_version_id), JSON.stringify({ revision: saved.revision, slots }));
      else window.sessionStorage.removeItem(storageKey(saved.pog_version_id));
    } catch {
      // Storage unavailable (private mode): nothing to keep.
    }
  }, [dirty, slots, saved.pog_version_id, saved.revision, restorable, restoreDismissed]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(next: EditorSlot[]) {
    if (save.kind === "saving" || publishing) return;
    setSlots(next);
    setRestoreDismissed(true);
    if (save.kind === "saved") setSave({ kind: "idle" });
  }

  const update = (key: string, change: Partial<EditorSlot>) => edit(slots.map((s) => (s.key === key ? { ...s, ...change } : s)));

  function chooseSlot(key: string | null) {
    if (key !== selected) setInvalidCoordinates({}); // switching slots discards uncommitted numeric text
    setSelected(key);
  }

  function nextLabel() {
    const used = new Set(slots.map((s) => s.label.trim().toLowerCase()));
    for (let n = slots.length + 1; ; n++) if (!used.has(`s${n}`)) return `S${n}`;
  }

  function addSlot(rect: Rect | null) {
    const spot = rect ?? findFreeSpot(slots, { width: 0.2, height: 0.2 }) ?? findFreeSpot(slots, { width: 0.05, height: 0.05 });
    if (!spot) {
      setAnnouncement("There is no free space for another slot. Make a slot smaller first.");
      return;
    }
    const key = `new-${++counter.current}-${crypto.randomUUID()}`;
    const lastProduct = slots.at(-1)?.product_id;
    const product = lastProduct && productsById.get(lastProduct)?.active ? lastProduct : activeProducts[0]?.product_id ?? "";
    const order = Math.min(999, slots.reduce((m, s) => Math.max(m, wholeOrNaN(s.sort_order) || 0), -1) + 1);
    const label = nextLabel();
    edit([...slots, { key, label, product_id: product, ...spot, target: "1", threshold: "", sort_order: String(order) }]);
    setSelected(key);
    setAnnouncement(`Slot ${label} added at x ${pct(spot.x)}, y ${pct(spot.y)}. Set its product, target and trigger in the slot fields.`);
  }

  function removeSlot(key: string) {
    const slot = slots.find((s) => s.key === key);
    setInvalidCoordinates((old) => Object.fromEntries(Object.entries(old).filter(([field]) => !field.startsWith(`${key}:`))));
    edit(slots.filter((s) => s.key !== key));
    setSelected(null);
    if (slot) setAnnouncement(`Slot ${slot.label || "without label"} removed. Save the draft to keep this change.`);
  }

  async function saveDraft(revision = saved.revision) {
    if (numericInvalid) return;
    setSave({ kind: "saving" });
    const body = { expected_revision: revision, slots: toPayload(slots), ...(saved.slots_need_review && confirmChecked ? { confirm_coordinates: true } : {}) };
    const request = JSON.stringify(body);
    if (saveKey.current?.request !== request) saveKey.current = { request, key: crypto.randomUUID() };
    const result = await apiRequest<PogVersionDetail>(`/pog-versions/${saved.pog_version_id}/slots`, { method: "PUT", body, idempotencyKey: saveKey.current.key });
    if (!result.ok) {
      setSave(result.failure.kind === "conflict" && result.failure.code === "CONFLICT" && /changed|revision/i.test(result.failure.message) ? { kind: "conflict" } : { kind: "failed", failure: result.failure });
      return;
    }
    saveKey.current = null;
    const labelOf = new Map(slots.map((s) => [s.label.trim().toLowerCase(), s.key]));
    const next = fromDetail(result.data);
    setSaved(result.data);
    setSlots(next);
    setConfirmChecked(false);
    if (selected) setSelected(next.find((s) => labelOf.get(s.label.toLowerCase()) === selected)?.key ?? null);
    setSave({ kind: "saved", at: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date()) });
    setAnnouncement(`Draft saved with ${next.length} ${next.length === 1 ? "slot" : "slots"}.`);
  }

  /** After a conflict: re-read the latest revision and save this layout over it. */
  async function saveOverLatest() {
    if (!window.confirm("Save your layout over the newer version? Changes made elsewhere since you opened this draft will be replaced by what you see here.")) return;
    const latest = await apiRequest<PogVersionDetail>(`/pogs/${saved.pog_id}/versions/${saved.pog_version_id}`, { method: "GET" });
    if (!latest.ok) {
      setSave({ kind: "failed", failure: latest.failure });
      return;
    }
    if (latest.data.state !== "draft") {
      setSave({ kind: "failed", failure: { kind: "conflict", status: 409, code: "PUBLISHED", message: "This version has been published meanwhile and can no longer change. Reload to see it.", fieldErrors: {} } });
      return;
    }
    if (latest.data.reference?.validated_at !== saved.reference?.validated_at) {
      setConfirmChecked(false);
      setSave({ kind: "failed", failure: { kind: "conflict", status: 409, code: "CONFLICT", message: "The reference image changed. Reload and review every slot on the new image before saving.", fieldErrors: {} } });
      return;
    }
    setSaved({ ...saved, revision: latest.data.revision, slots_need_review: latest.data.slots_need_review, reference: latest.data.reference });
    await saveDraft(latest.data.revision);
  }

  async function publish() {
    if (!window.confirm(`Publish version ${saved.version_number} of ${saved.pog_name}? It becomes read-only. No display changes until a manager or admin assigns it on the Displays page.`)) return;
    setPublishing(true);
    setPublishFailure(null);
    if (publishKey.current?.revision !== saved.revision) publishKey.current = { revision: saved.revision, key: crypto.randomUUID() };
    const result = await apiRequest<PogVersionDetail>(`/pog-versions/${saved.pog_version_id}/publish`, {
      method: "POST",
      body: { expected_revision: saved.revision },
      idempotencyKey: publishKey.current.key,
    });
    setPublishing(false);
    if (!result.ok) {
      setPublishFailure(result.failure);
      return;
    }
    try {
      window.sessionStorage.removeItem(storageKey(saved.pog_version_id));
    } catch {
      // ignore
    }
    router.replace(`/pogs/${saved.pog_id}/versions/${saved.pog_version_id}?published=1`);
    router.refresh();
  }

  const canvasRects: CanvasRect[] = slots.map((s) => {
    const product = productsById.get(s.product_id);
    const problem = issueKeys.has(s.key);
    return {
      key: s.key,
      rect: s,
      label: s.label,
      hasIssue: problem,
      description: `Slot ${s.label || "without label"}, ${product?.name ?? "no product"}, x ${pct(s.x)}, y ${pct(s.y)}, width ${pct(s.width)}, height ${pct(s.height)}${problem ? ", has a problem" : ""}`,
    };
  });

  const publishBlocked = numericInvalid || dirty || issues.length > 0 || sortIssues.length > 0 || saved.pog_archived;
  const serverErrors = save.kind === "failed" && save.failure.kind === "validation" ? Object.entries(save.failure.fieldErrors) : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Save / publish bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
          {save.kind === "saving" ? (
            "Saving…"
          ) : save.kind === "conflict" ? (
            <>
              <CircleAlert aria-hidden className="size-4 text-destructive" /> Not saved: this draft changed elsewhere.
            </>
          ) : save.kind === "failed" ? (
            <>
              <CircleAlert aria-hidden className="size-4 text-destructive" /> Not saved.
            </>
          ) : dirty ? (
            <>
              <TriangleAlert aria-hidden className="size-4 text-warning" /> Unsaved changes
            </>
          ) : save.kind === "saved" ? (
            <>
              <CircleCheck aria-hidden className="size-4 text-success" /> Saved at {save.at}
            </>
          ) : (
            <>
              <CircleCheck aria-hidden className="size-4 text-success" /> All changes saved
            </>
          )}
          <span className="text-muted-foreground">· revision {saved.revision}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={numericInvalid || save.kind === "saving" || publishing || (!dirty && !(saved.slots_need_review && confirmChecked)) || saveBlockers.length > 0 || sortIssues.length > 0}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60"
          >
            <Save aria-hidden className="size-4" />
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={publishBlocked || publishing || save.kind === "saving"}
            aria-describedby={`${liveId}-publish-help`}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 font-medium disabled:opacity-60"
          >
            <Send aria-hidden className="size-4" />
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
        <p id={`${liveId}-publish-help`} className="w-full text-xs text-muted-foreground">
          {saved.pog_archived
            ? "This POG is archived; restore it on the POGs page before publishing."
            : dirty
              ? "Save the draft before publishing."
              : issues.length || sortIssues.length
                ? "Fix the problems listed below to publish."
                : "Ready to publish. Publishing does not change any display; assign the version on the Displays page."}
        </p>
      </div>

      {save.kind === "conflict" ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-card p-4 text-sm">
          <p>
            Someone saved this draft (in another tab or as another admin) after you opened it, so your layout was <strong>not</strong> saved. Your layout is still
            here. Reload to see their version (your unsaved changes here are discarded), or save yours over it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => router.refresh()} className="min-h-10 rounded-lg border border-border px-3 font-medium">
              Reload latest
            </button>
            <button type="button" onClick={() => void saveOverLatest()} className="min-h-10 rounded-lg border border-destructive/50 px-3 font-medium text-destructive">
              Save mine over it
            </button>
          </div>
        </div>
      ) : null}
      {save.kind === "failed" && save.failure.kind !== "validation" ? <FailureNotice failure={save.failure} what="draft" /> : null}
      {serverErrors.length ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          <p className="font-medium">The server did not accept the layout:</p>
          <ul className="list-disc pl-5">
            {serverErrors.map(([field, messages]) => (
              <li key={field}>{messages.join(" ")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {publishFailure ? (
        publishFailure.kind === "validation" ? (
          <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
            <p className="font-medium">Not published. {publishFailure.message}</p>
            <ul className="list-disc pl-5">
              {Object.values(publishFailure.fieldErrors)
                .flat()
                .map((m) => (
                  <li key={m}>{m}</li>
                ))}
            </ul>
          </div>
        ) : (
          <FailureNotice failure={publishFailure} what="draft" />
        )
      ) : null}

      {restorable ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning bg-warning-surface p-3 text-sm">
          <span className="flex-1">This tab has unsaved changes to this draft from earlier (for example before signing in again).</span>
          <button type="button" onClick={() => edit(restorable)} className="min-h-10 rounded-lg border border-border bg-card px-3 font-medium">
            Restore unsaved changes
          </button>
          <button type="button" onClick={() => setRestoreDismissed(true)} className="min-h-10 rounded-lg border border-border bg-card px-3 font-medium">
            Discard
          </button>
        </div>
      ) : null}

      {saved.slots_need_review ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-surface p-4 text-sm">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            The reference image was replaced. Check every slot on the new image and adjust it where needed. Publishing stays blocked until you confirm.
          </p>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="size-5" />
            I checked every slot against the new image (applies when you save)
          </label>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-3">
          <SlotCanvas
            imageUrl={imageUrl}
            readOnly={save.kind === "saving" || publishing}
            aspect={aspect}
            label={`Slots of ${saved.pog_name} version ${saved.version_number}`}
            placeholder={hasReference ? undefined : "Upload a reference image below to draw on it. You can still add slots with the button and fields."}
            rects={canvasRects}
            selectedKey={selected}
            onSelect={chooseSlot}
            onCreate={(rect) => addSlot(rect)}
            onDelete={removeSlot}
            onChange={(key, rect, via) => {
              update(key, rect);
              if (via === "keyboard") {
                const s = slots.find((x) => x.key === key);
                setAnnouncement(`${s?.label ?? "Slot"}: x ${pct(rect.x)}, y ${pct(rect.y)}, width ${pct(rect.width)}, height ${pct(rect.height)}`);
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addSlot(null)}
              disabled={activeProducts.length === 0 || slots.length >= 100}
              className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-60"
            >
              <Plus aria-hidden className="size-4" /> Add slot
            </button>
            {activeProducts.length === 0 ? <span className="text-sm text-muted-foreground">Add active products on the Products page first.</span> : null}
          </div>
          <p id={liveId} role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>

        <aside aria-label="Selected slot" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <fieldset disabled={save.kind === "saving" || publishing}>
          {selectedSlot ? (
            <SlotFields
              key={selectedSlot.key}
              slot={selectedSlot}
              products={products}
              issues={issuesFor(selectedSlot.key)}
              onChange={(change) => update(selectedSlot.key, change)}
              onCoordinateValidity={(field, invalid) => setInvalidCoordinates((old) => ({ ...old, [`${selectedSlot.key}:${field}`]: invalid }))}
              onRemove={() => removeSlot(selectedSlot.key)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a slot on the image or in the list to edit its position, product, target and refill trigger.</p>
          )}
          </fieldset>
        </aside>
      </div>

      <SlotTable slots={slots} productsById={productsById} issueKeys={issueKeys} selected={selected} onSelect={chooseSlot} />

      <IssueList issues={issues} sortIssueLabels={sortIssues.map((s) => s.label || "without label")} />

      <ReferenceUpload
        version={saved}
        replacing={hasReference}
        blockedReason={dirty ? "Save or undo your slot changes before changing the reference image." : null}
      />
    </div>
  );
}

function SlotFields({ slot, products, issues, onChange, onRemove, onCoordinateValidity }: {
  slot: EditorSlot;
  products: ProductOption[];
  issues: LayoutIssue[];
  onChange: (change: Partial<EditorSlot>) => void;
  onRemove: () => void;
  onCoordinateValidity: (field: string, invalid: boolean) => void;
}) {
  const id = useId();
  const current = products.find((p) => p.product_id === slot.product_id);
  const options = products.filter((p) => p.active || p.product_id === slot.product_id);
  const threshold = wholeOrNull(slot.threshold);
  const target = wholeOrNaN(slot.target);
  const outOfCrop = slot.x + slot.width > 1.0000001 || slot.y + slot.height > 1.0000001;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Slot {slot.label || "(no label)"}</h2>
      <PlainField label="Label" value={slot.label} maxLength={40} onChange={(label) => onChange({ label })} hint="Unique in this layout, e.g. A1." errors={issues.filter((i) => i.code.startsWith("label")).map((i) => i.message)} />
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-product`} className="font-medium">
          Product
        </label>
        <select
          id={`${id}-product`}
          value={slot.product_id}
          onChange={(e) => onChange({ product_id: e.target.value })}
          aria-invalid={!current || !current.active ? true : undefined}
          className="min-h-10 rounded-lg border border-input bg-background px-2 aria-[invalid=true]:border-destructive"
        >
          {!current ? <option value="">Choose a product</option> : null}
          {options.map((p) => (
            <option key={p.product_id} value={p.product_id}>
              {p.name}
              {p.active ? "" : " (archived)"}
            </option>
          ))}
        </select>
        {current && !current.active ? <span className="text-destructive">This product is archived. Choose an active product to publish.</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PlainField label="Target" numeric value={slot.target} onChange={(t) => onChange({ target: t })} errors={Number.isNaN(target) || target < 1 || target > 999 ? ["Whole number, 1–999."] : undefined} />
        <PlainField
          label="Refill trigger"
          optional
          numeric
          value={slot.threshold}
          onChange={(t) => onChange({ threshold: t })}
          hint="Refill when the count is at or below this. Empty: always top up."
          errors={threshold !== null && (Number.isNaN(threshold) || threshold < 0 || (!Number.isNaN(target) && threshold > target)) ? ["Whole number from 0 to the target."] : undefined}
        />
      </div>
      <PlainField label="Sort order" numeric value={slot.sort_order} onChange={(o) => onChange({ sort_order: o })} hint="Order in count lists (0–999)." errors={(() => { const n = wholeOrNaN(slot.sort_order); return n >= 0 && n <= 999 ? undefined : ["Whole number, 0–999."]; })()} />
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-1 text-sm font-medium">Position on the reference crop</legend>
        <PercentField onValidityChange={(invalid) => onCoordinateValidity("X (left)", invalid)} label="X (left)" value={slot.x} min={0} max={100} maxExclusive onCommit={(x) => onChange({ x })} errors={slot.x + slot.width > 1.0000001 ? ["X + width exceeds 100 %."] : undefined} />
        <PercentField onValidityChange={(invalid) => onCoordinateValidity("Y (top)", invalid)} label="Y (top)" value={slot.y} min={0} max={100} maxExclusive onCommit={(y) => onChange({ y })} errors={slot.y + slot.height > 1.0000001 ? ["Y + height exceeds 100 %."] : undefined} />
        <PercentField onValidityChange={(invalid) => onCoordinateValidity("Width", invalid)} label="Width" value={slot.width} min={0} minExclusive max={100} onCommit={(width) => onChange({ width })} />
        <PercentField onValidityChange={(invalid) => onCoordinateValidity("Height", invalid)} label="Height" value={slot.height} min={0} minExclusive max={100} onCommit={(height) => onChange({ height })} />
      </fieldset>
      {issues.filter((i) => i.code === "overlap" || i.code === "bounds").map((i) => (
        <p key={i.message} className="flex items-start gap-1 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {i.message}
        </p>
      ))}
      {outOfCrop ? <p className="text-sm text-muted-foreground">Values outside the image are kept as typed so you can fix them; the draft cannot be saved until the slot fits.</p> : null}
      <button type="button" onClick={onRemove} className="flex min-h-10 items-center gap-1 self-start rounded-lg border border-destructive/50 px-3 text-sm font-medium text-destructive">
        <Trash2 aria-hidden className="size-4" /> Remove slot {slot.label}
      </button>
    </div>
  );
}

function SlotTable({ slots, productsById, issueKeys, selected, onSelect }: {
  slots: EditorSlot[];
  productsById: Map<string, ProductOption>;
  issueKeys: Set<string>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  if (slots.length === 0) return <p className="rounded-lg border border-dashed border-border bg-card p-4 text-sm">No slots yet. Draw one on the image or use “Add slot”.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Slots in this draft</caption>
        <thead className="border-b border-border text-left text-muted-foreground">
          <tr>
            <th scope="col" className="p-2 font-medium">Label</th>
            <th scope="col" className="p-2 font-medium">Product</th>
            <th scope="col" className="p-2 text-right font-medium">Target</th>
            <th scope="col" className="p-2 text-right font-medium">Trigger</th>
            <th scope="col" className="p-2 text-right font-medium">Order</th>
            <th scope="col" className="p-2 font-medium">Position (x, y, w, h %)</th>
            <th scope="col" className="p-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.key} className={`border-b border-border last:border-0 ${s.key === selected ? "bg-primary/10" : ""}`}>
              <td className="p-2">
                <button type="button" onClick={() => onSelect(s.key)} aria-pressed={s.key === selected} className="min-h-10 font-medium underline">
                  {s.label || "(no label)"}
                </button>
              </td>
              <td className="p-2">{productsById.get(s.product_id)?.name ?? "—"}</td>
              <td className="tabular p-2 text-right">{s.target}</td>
              <td className="tabular p-2 text-right">{s.threshold === "" ? "—" : s.threshold}</td>
              <td className="tabular p-2 text-right">{s.sort_order}</td>
              <td className="tabular p-2">
                {formatPercent(s.x)}, {formatPercent(s.y)}, {formatPercent(s.width)}, {formatPercent(s.height)}
              </td>
              <td className="p-2">
                {issueKeys.has(s.key) ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <TriangleAlert aria-hidden className="size-4" /> Needs attention
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <CircleCheck aria-hidden className="size-4 text-success" /> OK
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssueList({ issues, sortIssueLabels }: { issues: LayoutIssue[]; sortIssueLabels: string[] }) {
  if (issues.length === 0 && sortIssueLabels.length === 0) return null;
  return (
    <section aria-labelledby="layout-issues" className="rounded-lg border border-border bg-card p-4">
      <h2 id="layout-issues" className="text-base font-semibold">
        Before publishing
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {issues.map((i, n) => (
          <li key={`${i.code}-${n}`} className="flex items-start gap-2">
            <CircleAlert aria-hidden className={`mt-0.5 size-4 shrink-0 ${i.blocks === "save" ? "text-destructive" : "text-warning"}`} />
            <span>
              {i.message} {i.blocks === "save" ? <span className="text-muted-foreground">(blocks saving)</span> : null}
            </span>
          </li>
        ))}
        {sortIssueLabels.map((label) => (
          <li key={`sort-${label}`} className="flex items-start gap-2">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              Slot {label}: sort order must be a whole number from 0 to 999. <span className="text-muted-foreground">(blocks saving)</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
