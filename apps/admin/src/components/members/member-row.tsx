"use client";

import type { Member } from "@display-refill/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Assignment, callMembersApi, type StoreOption } from "./members-api";
import { StoreAssignments } from "./store-assignments";

/** One member with inline role/store/access editing. Saves with expected_revision. */
export function MemberRow({ member, organizationId, stores, isSelf }: { member: Member; organizationId: string; stores: StoreOption[]; isSelf: boolean }) {
  const router = useRouter();
  const initialAssignments: Assignment[] = member.stores.filter((s) => s.active).map(({ store_id, role }) => ({ store_id, role }));
  const [editing, setEditing] = useState(false);
  const [orgRole, setOrgRole] = useState(member.org_role);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function save(change: { org_role?: "member" | "admin"; active?: boolean; stores?: Assignment[] }) {
    setBusy(true);
    setError(null);
    const result = await callMembersApi(`/${member.user_id}`, "PATCH", { organization_id: organizationId, expected_revision: member.revision, ...change }, idempotencyKey);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    setEditing(false);
    router.refresh();
  }

  const storeName = new Map(stores.map((s) => [s.store_id, s.name]));
  const label = member.display_name || member.email || member.user_id;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium">
            {label} {isSelf ? <span className="text-sm text-muted-foreground">(you)</span> : null}
          </span>
          {member.display_name ? <span className="text-sm text-muted-foreground">{member.email}</span> : null}
          <span className="text-sm text-muted-foreground">
            {member.active ? (member.org_role === "admin" ? "Admin · all stores" : "Member") : "Access revoked"}
            {member.active && member.org_role === "member" && initialAssignments.length > 0
              ? ` · ${initialAssignments.map((a) => `${storeName.get(a.store_id) ?? "store"} (${a.role})`).join(", ")}`
              : ""}
            {member.last_sign_in_at ? "" : " · has not signed in yet"}
          </span>
        </div>
        <div className="flex gap-2">
          {member.active ? (
            <button type="button" onClick={() => setEditing((e) => !e)} disabled={busy} className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium">
              {editing ? "Cancel" : "Edit"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (member.active && !window.confirm(`Revoke access for ${label}? They lose access on their next request.`)) return;
              void save({ active: !member.active });
            }}
            className={`min-h-10 rounded-lg px-3 text-sm font-medium ${member.active ? "border border-destructive/50 text-destructive" : "border border-border"}`}
          >
            {member.active ? "Revoke access" : "Restore access"}
          </button>
        </div>
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ org_role: orgRole, stores: assignments });
          }}
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <label className="flex flex-col gap-1 text-sm font-medium sm:w-1/2">
            Organization role
            <select value={orgRole} onChange={(e) => setOrgRole(e.target.value as "member" | "admin")} className="min-h-10 rounded-lg border border-input bg-background px-2 font-normal">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <StoreAssignments stores={stores} value={assignments} onChange={setAssignments} disabled={orgRole === "admin"} />
          <button type="submit" disabled={busy} className="min-h-10 self-start rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
