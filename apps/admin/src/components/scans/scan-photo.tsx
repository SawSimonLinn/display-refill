"use client";

import { ImageOff, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type State =
  | { kind: "loading" }
  | { kind: "shown"; url: string }
  | { kind: "deleted"; message: string }
  | { kind: "failed"; message: string; retry: boolean };

/**
 * The scan's retained photo through `GET /api/v1/scans/:id/image`: the API
 * repeats the caller-scoped access check and returns a five-minute link that
 * is kept only in memory. An expired link (image load error) can be renewed.
 */
export function ScanPhoto({ scanId, alt }: { scanId: string; alt: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await apiRequest<{ url: string }>(`/scans/${scanId}/image`, { method: "GET" });
    if (result.ok) return setState({ kind: "shown", url: result.data.url });
    const f = result.failure;
    if (f.status === 410) return setState({ kind: "deleted", message: f.message });
    if (f.kind === "session") return setState({ kind: "failed", message: "Your session expired. Sign in again to view the photo.", retry: false });
    if (f.kind === "not_found" || f.kind === "forbidden") return setState({ kind: "failed", message: "This photo is not available to you.", retry: false });
    setState({ kind: "failed", message: f.kind === "network" ? f.message : "The photo could not be loaded.", retry: true });
  }, [scanId]);
  useEffect(() => {
    // Fetching the signed link is the effect's purpose; state updates follow the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (state.kind === "loading")
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        Loading photo…
      </p>
    );
  if (state.kind === "deleted")
    return (
      <p role="status" className="flex items-start gap-2 text-sm">
        <ImageOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {state.message}
      </p>
    );
  if (state.kind === "failed")
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p>{state.message}</p>
        {state.retry ? (
          <button type="button" onClick={() => void load()} className="min-h-10 rounded-lg border border-border px-3 font-medium">
            Try again
          </button>
        ) : state.message.startsWith("Your session") ? (
          <a href="/sign-in" className="font-medium underline">
            Sign in
          </a>
        ) : null}
      </div>
    );
  return (
    <figure className="flex flex-col gap-2">
      {/* Short-lived private link; next/image would cache it through the image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={state.url} alt={alt} onError={() => setState({ kind: "failed", message: "The photo link expired.", retry: true })} className="max-h-[28rem] w-auto rounded-lg border border-border object-contain" />
      <figcaption className="text-xs text-muted-foreground">Validated, cropped photo as analysed. The link expires after five minutes; reload to view again.</figcaption>
    </figure>
  );
}
