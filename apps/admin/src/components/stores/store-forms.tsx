"use client";

import type { Store } from "@display-refill/domain";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchivedBadge } from "../catalog/list-parts";
import { errorsFor, FailureNotice, SecondaryButton, SelectField, SubmitButton, TextField, useEdits, useMutation } from "../catalog/form-kit";

type Fields = { name: string; store_number: string; timezone: string };

function StoreFields({ value, onChange, failure }: { value: Fields; onChange: (next: Fields) => void; failure: ReturnType<typeof useMutation>["failure"] }) {
  const set = (key: keyof Fields) => (v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextField label="Store name" value={value.name} onChange={set("name")} required maxLength={200} errors={errorsFor(failure, "name")} />
      <TextField label="Store number" value={value.store_number} onChange={set("store_number")} required maxLength={50} errors={errorsFor(failure, "store_number")} hint="Unique in your organization." />
      <TextField label="Time zone" value={value.timezone} onChange={set("timezone")} required maxLength={64} list="iana-time-zones" errors={errorsFor(failure, "timezone")} hint="IANA name, e.g. America/Los_Angeles." />
    </div>
  );
}

export function CreateStoreForm({ organizations }: { organizations: Array<{ organization_id: string; name: string }> }) {
  const router = useRouter();
  const empty: Fields = { name: "", store_number: "", timezone: "" };
  const [fields, setFields] = useState(empty);
  const [org, setOrg] = useState(organizations[0]?.organization_id ?? "");
  const [created, setCreated] = useState<string | null>(null);
  const { busy, failure, run } = useMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreated(null);
    const store = await run<Store>("/stores", "POST", { organization_id: org, ...fields });
    if (!store) return;
    setFields(empty);
    setCreated(`${store.name} (#${store.store_number}) was added.`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5" aria-label="Add a store">
      <h2 className="text-lg font-semibold">Add a store</h2>
      {organizations.length > 1 ? (
        <SelectField label="Organization" value={org} onChange={setOrg} options={organizations.map((o) => ({ value: o.organization_id, label: o.name }))} />
      ) : null}
      <StoreFields value={fields} onChange={setFields} failure={failure} />
      <FailureNotice failure={failure} what="store" />
      {created ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <CircleCheck aria-hidden className="size-4 text-success" />
          {created}
        </p>
      ) : null}
      <SubmitButton busy={busy} busyLabel="Adding…">
        Add store
      </SubmitButton>
    </form>
  );
}

/**
 * One store. Admins edit name/number/time zone and archive or restore. The
 * save sends the revision the admin saw; a newer revision returns 409 and the
 * edits stay in the form until the admin reloads and saves again.
 */
export function StoreRow({ store, canEdit }: { store: Store; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const edits = useEdits<Fields>({ name: store.name, store_number: store.store_number, timezone: store.timezone });
  const { busy, failure, run, clear } = useMutation();

  async function save(change: Partial<Fields> & { active?: boolean }) {
    if (Object.keys(change).length === 0) {
      setEditing(false); // nothing edited
      return;
    }
    const updated = await run<Store>(`/stores/${store.store_id}`, "PATCH", { expected_revision: store.revision, ...change });
    if (!updated) return;
    setEditing(false);
    edits.reset();
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {store.name}
            {store.active ? null : <ArchivedBadge label="Archived · no new scans" />}
          </span>
          <span className="text-sm text-muted-foreground">
            Store #{store.store_number} · {store.timezone}
          </span>
          <Link href={`/displays?store_id=${store.store_id}`} aria-label={`Displays in ${store.name}`} className="text-sm font-medium underline">
            Displays in this store
          </Link>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {store.active ? (
              <SecondaryButton
                subject={store.name}
                onClick={() => {
                  clear();
                  edits.reset();
                  setEditing(!editing);
                }}
                disabled={busy}
              >
                {editing ? "Cancel" : "Edit"}
              </SecondaryButton>
            ) : null}
            <SecondaryButton
              subject={store.name}
              tone={store.active ? "destructive" : "neutral"}
              disabled={busy}
              onClick={() => {
                if (store.active && !window.confirm(`Archive ${store.name}? New scans in this store are blocked; its history stays available.`)) return;
                void save({ active: !store.active });
              }}
            >
              {store.active ? "Archive" : "Restore"}
            </SecondaryButton>
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          aria-label={`Edit ${store.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(edits.changes);
          }}
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <StoreFields value={edits.value} onChange={edits.onChange} failure={failure} />
          <SubmitButton busy={busy} busyLabel="Saving…">
            Save changes
          </SubmitButton>
        </form>
      ) : null}
      <FailureNotice failure={failure} what="store" />
    </li>
  );
}
