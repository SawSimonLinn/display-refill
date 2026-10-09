"use client";

import { useEffect, useState } from "react";
import { type ApiFailure, apiRequest } from "@/lib/api-client";
import { FailureNotice, SecondaryButton, useMutation } from "../catalog/form-kit";

type AccessCode = { code: string | null; active: boolean; updated_at: string | null };

/**
 * The organization's access code (Feature 16). People who sign up in the iPhone app enter it to
 * join as members, then create or join their store by number. Rotating stops the old code.
 */
export function AccessCodeCard({ organizationId }: { organizationId: string }) {
  const path = `/access-code?organization_id=${organizationId}`;
  const [state, setState] = useState<AccessCode | null>(null);
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, failure, run } = useMutation();

  useEffect(() => {
    let live = true;
    void apiRequest<AccessCode>(path, { method: "GET" }).then((r) => {
      if (!live) return;
      if (r.ok) setState(r.data);
      else setLoadFailure(r.failure);
    });
    return () => { live = false; };
  }, [path]);

  async function act(action: "rotate" | "disable" | "enable") {
    if (action === "rotate" && state?.code && !window.confirm("Make a new code? The current code stops working immediately; people who already joined keep their access.")) return;
    const next = await run<AccessCode>(path, "POST", { action });
    if (next) { setState(next); setCopied(false); }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5" aria-labelledby="access-code">
      <h2 id="access-code" className="text-lg font-semibold">Access code</h2>
      <p className="text-sm text-muted-foreground">
        Share this code with staff. They sign up in the iPhone app with their email, enter the code, then create their store (becoming its manager) or join it by store number.
        Anyone with the code can join any store in your organization, so share it only with your team.
      </p>
      <FailureNotice failure={loadFailure ?? failure} what="the access code" />
      {state && (state.code ? (
        <div className="flex flex-wrap items-center gap-3">
          <code className={`rounded-lg border border-border px-4 py-2 font-mono text-2xl tracking-widest ${state.active ? "" : "line-through opacity-60"}`} aria-label={`Access code ${state.code.split("").join(" ")}`}>{state.code}</code>
          {state.active ? (
            <>
              <SecondaryButton onClick={() => void navigator.clipboard.writeText(state.code!).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</SecondaryButton>
              <SecondaryButton onClick={() => void act("rotate")} disabled={busy}>New code</SecondaryButton>
              <SecondaryButton onClick={() => void act("disable")} disabled={busy} tone="destructive">Turn off</SecondaryButton>
            </>
          ) : (
            <>
              <span className="text-sm text-warning">Turned off — nobody can join with it.</span>
              <SecondaryButton onClick={() => void act("enable")} disabled={busy}>Turn on</SecondaryButton>
              <SecondaryButton onClick={() => void act("rotate")} disabled={busy}>New code</SecondaryButton>
            </>
          )}
        </div>
      ) : (
        <div><SecondaryButton onClick={() => void act("rotate")} disabled={busy}>Create access code</SecondaryButton></div>
      ))}
    </section>
  );
}
