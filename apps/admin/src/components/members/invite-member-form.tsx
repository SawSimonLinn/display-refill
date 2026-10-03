"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Assignment, callMembersApi, type StoreOption } from "./members-api";
import { StoreAssignments } from "./store-assignments";

export function InviteMemberForm({ organizationId, stores }: { organizationId: string; stores: StoreOption[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgRole, setOrgRole] = useState<"member" | "admin">("member");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  // One key per invitation attempt; kept when the same submission is retried.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await callMembersApi(
      "/invite",
      "POST",
      { organization_id: organizationId, email, display_name: displayName || undefined, org_role: orgRole, stores: assignments },
      idempotencyKey,
    );
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    setMessage({ tone: "success", text: `Invitation sent to ${email}.` });
    setEmail("");
    setDisplayName("");
    setOrgRole("member");
    setAssignments([]);
    setIdempotencyKey(crypto.randomUUID());
    router.refresh();
  }

  // Editing the form after a failure makes it a new request.
  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setIdempotencyKey(crypto.randomUUID());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">Invite someone</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input type="email" required maxLength={254} value={email} onChange={(e) => edit(setEmail)(e.target.value)} className="min-h-10 rounded-lg border border-input bg-background px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name (optional)
          <input type="text" maxLength={200} value={displayName} onChange={(e) => edit(setDisplayName)(e.target.value)} className="min-h-10 rounded-lg border border-input bg-background px-3 font-normal" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium sm:w-1/2">
        Organization role
        <select value={orgRole} onChange={(e) => edit(setOrgRole)(e.target.value as "member" | "admin")} className="min-h-10 rounded-lg border border-input bg-background px-2 font-normal">
          <option value="member">Member (store roles below)</option>
          <option value="admin">Admin (all stores, members, catalog)</option>
        </select>
      </label>
      {orgRole === "member" ? <StoreAssignments stores={stores} value={assignments} onChange={edit(setAssignments)} /> : null}
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
          {message.text}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="min-h-10 self-start rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">
        {busy ? "Sending…" : "Send invitation"}
      </button>
    </form>
  );
}
