"use client";

import type { PogVersionDetail } from "@display-refill/domain";
import { CopyPlus, FilePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FailureNotice, useMutation } from "../catalog/form-kit";
import { formatPercent } from "./fields";
import { SlotCanvas } from "./slot-canvas";

const pct = (v: number) => `${formatPercent(v)} %`;

/** Read-only layout of a published version (or of any version for managers). */
export function PogViewer({ detail, imageUrl }: { detail: PogVersionDetail; imageUrl: string | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const aspect = detail.reference ? detail.reference.width / detail.reference.height : 4 / 3;
  return (
    <div className="flex flex-col gap-4">
      <SlotCanvas
        readOnly
        imageUrl={imageUrl}
        aspect={aspect}
        label={`Slots of ${detail.pog_name} version ${detail.version_number} (read-only)`}
        rects={detail.slots.map((s) => ({
          key: s.slot_id,
          rect: s,
          label: s.label,
          description: `Slot ${s.label}, ${s.product_name}, target ${s.target_quantity}, x ${pct(s.x)}, y ${pct(s.y)}, width ${pct(s.width)}, height ${pct(s.height)}`,
        }))}
        selectedKey={selected}
        onSelect={setSelected}
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Slots in version {detail.version_number}</caption>
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th scope="col" className="p-2 font-medium">Label</th>
              <th scope="col" className="p-2 font-medium">Product</th>
              <th scope="col" className="p-2 text-right font-medium">Target</th>
              <th scope="col" className="p-2 text-right font-medium">Refill trigger</th>
              <th scope="col" className="p-2 font-medium">Position (x, y, w, h %)</th>
            </tr>
          </thead>
          <tbody>
            {detail.slots.map((s) => (
              <tr key={s.slot_id} className={`border-b border-border last:border-0 ${s.slot_id === selected ? "bg-primary/10" : ""}`}>
                <td className="p-2">
                  <button type="button" onClick={() => setSelected(s.slot_id)} aria-pressed={s.slot_id === selected} className="min-h-10 font-medium underline">
                    {s.label}
                  </button>
                </td>
                <td className="p-2">
                  {s.product_name}
                  {s.product_active ? "" : " (archived)"}
                </td>
                <td className="tabular p-2 text-right">{s.target_quantity}</td>
                <td className="tabular p-2 text-right">{s.refill_threshold ?? "Always top up"}</td>
                <td className="tabular p-2">
                  {formatPercent(s.x)}, {formatPercent(s.y)}, {formatPercent(s.width)}, {formatPercent(s.height)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "Create new draft" from a published version, or a link to the open draft. Admins only. */
export function NewDraftAction({ detail }: { detail: PogVersionDetail }) {
  const router = useRouter();
  const { busy, failure, run } = useMutation();
  if (detail.draft_version_id) {
    return (
      <Link href={`/pogs/${detail.pog_id}/versions/${detail.draft_version_id}`} className="flex min-h-10 items-center gap-2 self-start rounded-lg border border-border px-4 font-medium">
        <FilePlus aria-hidden className="size-4" /> Open the current draft
      </Link>
    );
  }
  async function create(source: string | null) {
    const created = await run<PogVersionDetail>(`/pogs/${detail.pog_id}/versions`, "POST", { source_version_id: source });
    if (created) router.push(`/pogs/${detail.pog_id}/versions/${created.pog_version_id}`);
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || detail.pog_archived} onClick={() => void create(detail.pog_version_id)} className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">
          <CopyPlus aria-hidden className="size-4" /> {busy ? "Creating…" : `Create new draft from version ${detail.version_number}`}
        </button>
        <button type="button" disabled={busy || detail.pog_archived} onClick={() => void create(null)} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 font-medium disabled:opacity-60">
          <FilePlus aria-hidden className="size-4" /> Create blank draft
        </button>
      </div>
      {detail.pog_archived ? <p className="text-sm text-muted-foreground">This POG is archived. Restore it on the POGs page to create a draft.</p> : null}
      <FailureNotice failure={failure} what="POG" />
    </div>
  );
}
