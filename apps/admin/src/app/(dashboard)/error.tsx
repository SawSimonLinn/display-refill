"use client";

import { CircleAlert } from "lucide-react";

/** Unexpected failure while rendering a dashboard page: explain and offer a retry. */
export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-card p-5">
      <p className="flex items-center gap-2 font-medium">
        <CircleAlert aria-hidden className="size-5 text-destructive" />
        This page could not be loaded.
      </p>
      <p className="text-sm text-muted-foreground">The server or database may be briefly unavailable. Nothing was changed.</p>
      <button type="button" onClick={() => retry()} className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium">
        Try again
      </button>
    </div>
  );
}
