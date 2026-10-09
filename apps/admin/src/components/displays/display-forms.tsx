"use client";

import type { Display, PogKind } from "@display-refill/domain";
import { CircleArrowUp, CircleCheck, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchivedBadge } from "../catalog/list-parts";
import { POG_KINDS, pogKindLabel } from "@/lib/pog-kinds";
import { errorsFor, FailureNotice, SecondaryButton, SelectField, SubmitButton, TextField, useEdits, useMutation } from "../catalog/form-kit";
import { PogKindBadge } from "../pogs/pog-forms";

/** A published version that may be assigned (same organization, POG not archived). */
export interface VersionOption {
  pog_version_id: string;
  pog_id: string;
  pog_name: string;
  kind: PogKind | null;
  version_number: number;
  published_at: string | null;
  /** Newest published version of its POG. */
  latest: boolean;
}

const UNASSIGNED = "";
const ALL_KINDS = "";

const dateOnly = (iso: string | null, timeZone: string) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

function versionLabel(v: VersionOption, timezone: string) {
  return `${v.pog_name} · v${v.version_number} · updated ${dateOnly(v.published_at, timezone)}${v.latest ? " (latest)" : ""}`;
}

function versionOptions(shown: VersionOption[], current: Display["active_pog"], timezone: string) {
  const options = [{ value: UNASSIGNED, label: "Not assigned (scans blocked)" }, ...shown.map((v) => ({ value: v.pog_version_id, label: versionLabel(v, timezone) }))];
  // Keep the current assignment selectable even if its POG was archived or is another kind.
  if (current && !shown.some((v) => v.pog_version_id === current.pog_version_id)) {
    options.push({ value: current.pog_version_id, label: `${current.pog_name} · v${current.version_number} · updated ${dateOnly(current.published_at, timezone)} (current)` });
  }
  return options;
}

/** Newest published version of the assigned POG when it is newer than the assigned one. */
function newerVersion(versions: VersionOption[], current: Display["active_pog"]) {
  if (!current) return null;
  const latest = versions.find((v) => v.pog_id === current.pog_id && v.latest);
  return latest && latest.version_number > current.version_number ? latest : null;
}

const kindOptions = (versions: VersionOption[]) => [
  { value: ALL_KINDS, label: "All kinds" },
  // Standard types first, then any other display case types the versions use.
  ...[...new Set([...POG_KINDS, ...versions.flatMap((v) => (v.kind ? [v.kind] : []))])]
    .filter((k) => versions.some((v) => v.kind === k)).map((k) => ({ value: k, label: pogKindLabel(k) })),
  ...(versions.some((v) => v.kind === null) ? [{ value: "none", label: "No kind" }] : []),
];

/** Kind filter plus the published version select it narrows. */
function PogVersionPicker(props: {
  versions: VersionOption[];
  current: Display["active_pog"];
  value: string;
  onChange: (value: string) => void;
  timezone: string;
  errors?: string[];
  hint: string;
}) {
  const [kind, setKind] = useState<string>(props.current?.pog_kind ?? ALL_KINDS);
  const filter = kind === "none" ? null : kind;
  const filtered = kind === ALL_KINDS ? props.versions : props.versions.filter((v) => v.kind === filter);
  return (
    <>
      <SelectField label="POG kind" value={kind} onChange={setKind} options={kindOptions(props.versions)} hint="Show only layouts for this section." />
      <SelectField
        label="Published POG version"
        value={props.value}
        onChange={props.onChange}
        options={versionOptions(filtered, props.current, props.timezone)}
        errors={props.errors}
        hint={props.hint}
      />
    </>
  );
}

export function CreateDisplayForm({ storeId, storeName, versions, timezone }: { storeId: string; storeName: string; versions: VersionOption[]; timezone: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [version, setVersion] = useState(UNASSIGNED);
  const [created, setCreated] = useState<string | null>(null);
  const { busy, failure, run } = useMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreated(null);
    const display = await run<Display>(`/stores/${storeId}/displays`, "POST", { name, active_pog_version_id: version === UNASSIGNED ? null : version });
    if (!display) return;
    setName("");
    setVersion(UNASSIGNED);
    setCreated(`${display.name} was added to ${storeName}.`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5" aria-label="Add a display">
      <h2 className="text-lg font-semibold">Add a display to {storeName}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Display name" value={name} onChange={setName} required maxLength={200} errors={errorsFor(failure, "name")} hint="As staff know it, e.g. “Deli case 2”." />
        <PogVersionPicker
          versions={versions}
          current={null}
          value={version}
          onChange={setVersion}
          timezone={timezone}
          errors={errorsFor(failure, "active_pog_version_id")}
          hint={versions.length === 0 ? "No published versions yet. You can assign one later." : "Scans use the assigned version."}
        />
      </div>
      <FailureNotice failure={failure} what="display" />
      {created ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <CircleCheck aria-hidden className="size-4 text-success" />
          {created}
        </p>
      ) : null}
      <SubmitButton busy={busy} busyLabel="Adding…">
        Add display
      </SubmitButton>
    </form>
  );
}

const dateTime = (iso: string, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
};

export function DisplayRow({ display, canEdit, versions, timezone }: { display: Display; canEdit: boolean; versions: VersionOption[]; timezone: string }) {
  const router = useRouter();
  const current = display.active_pog?.pog_version_id ?? UNASSIGNED;
  const [editing, setEditing] = useState(false);
  const edits = useEdits({ name: display.name, version: current });
  const { busy, failure, run, clear } = useMutation();
  const newer = newerVersion(versions, display.active_pog);

  async function save(change: { name?: string; active?: boolean; active_pog_version_id?: string | null }) {
    if (Object.keys(change).length === 0) {
      setEditing(false);
      return;
    }
    const updated = await run<Display>(`/displays/${display.display_id}`, "PATCH", { expected_revision: display.revision, ...change });
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
            {display.name}
            {display.active ? null : <ArchivedBadge label="Archived · no new scans" />}
          </span>
          {display.active_pog ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <PogKindBadge kind={display.active_pog.pog_kind} />
              <span>
                {display.active_pog.pog_name} · <span className="tabular">v{display.active_pog.version_number}</span>
                {display.active_pog.published_at ? <span className="text-muted-foreground"> · updated {dateOnly(display.active_pog.published_at, timezone)}</span> : null}
                {display.active_pog.pog_archived ? <span className="text-muted-foreground"> (POG archived)</span> : null}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-sm">
              <TriangleAlert aria-hidden className="size-4 text-warning" />
              No POG assigned — new scans are blocked until a published version is assigned.
            </span>
          )}
          {newer ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <CircleArrowUp aria-hidden className="size-4 text-warning" />
              Newer version available: <span className="tabular">v{newer.version_number}</span>, updated {dateOnly(newer.published_at, timezone)}.
              {canEdit && display.active ? (
                <SecondaryButton
                  subject={display.name}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Switch ${display.name} to ${newer.pog_name} v${newer.version_number}? New scans use it; earlier scans keep theirs.`)) return;
                    void save({ active_pog_version_id: newer.pog_version_id });
                  }}
                >
                  {`Update to v${newer.version_number}`}
                </SecondaryButton>
              ) : null}
            </span>
          ) : null}
          {display.has_archived_products ? (
            <span className="flex items-center gap-1 text-sm">
              <TriangleAlert aria-hidden className="size-4 text-warning" />
              This layout uses an archived product. Assign a newer version.
            </span>
          ) : null}
          <span className="text-sm text-muted-foreground">{display.latest_scan_at ? `Last scan ${dateTime(display.latest_scan_at, timezone)}` : "No scans yet"}</span>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {display.active ? (
              <SecondaryButton
                subject={display.name}
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
              subject={display.name}
              tone={display.active ? "destructive" : "neutral"}
              disabled={busy}
              onClick={() => {
                if (display.active && !window.confirm(`Archive ${display.name}? New scans are blocked; earlier scans stay in history.`)) return;
                void save({ active: !display.active });
              }}
            >
              {display.active ? "Archive" : "Restore"}
            </SecondaryButton>
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          aria-label={`Edit ${display.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            const { name, version } = edits.changes;
            void save({
              ...(name !== undefined ? { name } : {}),
              ...(version !== undefined ? { active_pog_version_id: version === UNASSIGNED ? null : version } : {}),
            });
          }}
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Display name" value={edits.value.name} onChange={(name) => edits.onChange({ ...edits.value, name })} required maxLength={200} errors={errorsFor(failure, "name")} />
            <PogVersionPicker
              versions={versions}
              current={display.active_pog}
              value={edits.value.version}
              onChange={(version) => edits.onChange({ ...edits.value, version })}
              timezone={timezone}
              errors={errorsFor(failure, "active_pog_version_id")}
              hint="New scans pin the assigned version; earlier scans keep theirs."
            />
          </div>
          <SubmitButton busy={busy} busyLabel="Saving…">
            Save changes
          </SubmitButton>
        </form>
      ) : null}
      <FailureNotice failure={failure} what="display" />
    </li>
  );
}
