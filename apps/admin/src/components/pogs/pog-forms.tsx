"use client";

import type { Pog, PogKind } from "@display-refill/domain";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchivedBadge } from "../catalog/list-parts";
import { pogKindLabel, pogKindOptions } from "@/lib/pog-kinds";
import { errorsFor, FailureNotice, SecondaryButton, SelectField, SubmitButton, TextField, useEdits, useMutation } from "../catalog/form-kit";

export function PogKindBadge({ kind }: { kind: PogKind | null }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${kind ? "border-border" : "border-warning text-warning"}`}>{pogKindLabel(kind)}</span>
  );
}

export function CreatePogForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const { busy, failure, run } = useMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreated(null);
    const pog = await run<Pog>("/pogs", "POST", { organization_id: organizationId, name, kind });
    if (!pog) return;
    setName("");
    setKind("");
    setCreated(`${pog.name} was created. Opening its draft (version 1)…`);
    const draft = pog.versions.find((v) => v.state === "draft");
    if (draft) router.push(`/pogs/${pog.pog_id}/versions/${draft.pog_version_id}`);
    else router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5" aria-label="Create a POG">
      <h2 className="text-lg font-semibold">Create a POG</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="POG name" value={name} onChange={setName} required maxLength={200} errors={errorsFor(failure, "name")} hint="A reusable layout, e.g. “Mobile 2 salad case”." />
        <SelectField
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[{ value: "", label: "Choose a section…" }, ...pogKindOptions]}
          errors={errorsFor(failure, "kind")}
          hint="Stores pick from POGs of the same kind."
        />
      </div>
      <FailureNotice failure={failure} what="POG" />
      {created ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <CircleCheck aria-hidden className="size-4 text-success" />
          {created}
        </p>
      ) : null}
      <SubmitButton busy={busy} busyLabel="Creating…">
        Create POG
      </SubmitButton>
    </form>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function PogRow({ pog, canEdit }: { pog: Pog; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const edits = useEdits({ name: pog.name, kind: pog.kind ?? "" });
  const { busy, failure, run, clear } = useMutation();

  async function save(change: { name?: string; kind?: string; archived?: boolean }) {
    if (Object.keys(change).length === 0) {
      setEditing(false);
      return;
    }
    const updated = await run<Pog>(`/pogs/${pog.pog_id}`, "PATCH", { expected_revision: pog.revision, ...change });
    if (!updated) return;
    setEditing(false);
    edits.reset();
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {pog.name}
            <PogKindBadge kind={pog.kind} />
            {pog.archived ? <ArchivedBadge label="Archived · cannot be newly assigned" /> : null}
          </span>
          {pog.versions.length === 0 ? (
            <span className="text-sm text-muted-foreground">No versions visible to you.</span>
          ) : (
            <ul aria-label={`Versions of ${pog.name}`} className="flex flex-wrap gap-2 text-sm">
              {pog.versions.map((v) => (
                <li key={v.pog_version_id}>
                  <Link
                    href={`/pogs/${pog.pog_id}/versions/${v.pog_version_id}`}
                    aria-label={`${pog.name} version ${v.version_number}, ${v.state === "published" ? "published" : canEdit ? "draft, open the editor" : "draft"}`}
                    className="tabular flex min-h-10 items-center rounded-md border border-border px-2 underline-offset-2 hover:underline"
                  >
                    v{v.version_number} · {v.state === "published" ? `Published ${v.published_at ? dateFormat.format(new Date(v.published_at)) : ""}` : canEdit ? "Draft · edit" : "Draft"} · {v.slot_count}{" "}
                    {v.slot_count === 1 ? "slot" : "slots"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {pog.archived ? null : (
              <SecondaryButton
                subject={pog.name}
                onClick={() => {
                  clear();
                  edits.reset();
                  setEditing(!editing);
                }}
                disabled={busy}
              >
                {editing ? "Cancel" : "Edit"}
              </SecondaryButton>
            )}
            <SecondaryButton
              subject={pog.name}
              tone={pog.archived ? "neutral" : "destructive"}
              disabled={busy}
              onClick={() => {
                if (!pog.archived && !window.confirm(`Archive ${pog.name}? Displays keep their current version, but its versions cannot be newly assigned or published.`)) return;
                void save({ archived: !pog.archived });
              }}
            >
              {pog.archived ? "Restore" : "Archive"}
            </SecondaryButton>
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          aria-label={`Edit ${pog.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(edits.changes);
          }}
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="POG name" value={edits.value.name} onChange={(name) => edits.onChange({ ...edits.value, name })} required maxLength={200} errors={errorsFor(failure, "name")} />
            <SelectField
              label="Kind"
              value={edits.value.kind}
              onChange={(kind) => edits.onChange({ ...edits.value, kind })}
              options={[...(pog.kind ? [] : [{ value: "", label: "No kind — choose one" }]), ...pogKindOptions]}
              errors={errorsFor(failure, "kind")}
            />
          </div>
          <SubmitButton busy={busy} busyLabel="Saving…">
            Save changes
          </SubmitButton>
        </form>
      ) : null}
      <FailureNotice failure={failure} what="POG" />
    </li>
  );
}
