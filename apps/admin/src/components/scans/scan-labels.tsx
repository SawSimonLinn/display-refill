import type { ScanStatus } from "@display-refill/domain";
import { CircleAlert, CircleCheck, CircleDashed, Clock, FlaskConical, ImageOff, Loader, PencilLine, type LucideIcon } from "lucide-react";

/** Plain-language status. Completion is an employee attestation, never a stock reading. */
export const STATUS_LABEL: Record<ScanStatus, string> = {
  awaiting_upload: "Waiting for photo",
  queued: "Queued for analysis",
  processing: "Analysing photo",
  needs_review: "Needs review",
  failed: "Analysis failed",
  confirmed: "Confirmed",
  completed: "Refill marked done",
};

const STATUS_ICON: Record<ScanStatus, LucideIcon> = {
  awaiting_upload: Clock,
  queued: Clock,
  processing: Loader,
  needs_review: PencilLine,
  failed: CircleAlert,
  confirmed: CircleCheck,
  completed: CircleCheck,
};

export const isScanStatus = (value: string): value is ScanStatus => value in STATUS_LABEL;

/** Status is text plus icon, never color alone. */
export function StatusBadge({ status }: { status: string }) {
  const known = isScanStatus(status);
  const Icon = known ? STATUS_ICON[status] : CircleDashed;
  const tone = status === "failed" ? "text-destructive" : status === "needs_review" ? "text-warning" : status === "confirmed" || status === "completed" ? "text-success" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium">
      <Icon aria-hidden className={`size-4 shrink-0 ${tone}`} />
      {known ? STATUS_LABEL[status] : status}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium">
      <FlaskConical aria-hidden className="size-3 text-warning" />
      Synthetic test analysis
    </span>
  );
}

export function PhotoState({ state }: { state: string }) {
  if (state === "deleted")
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <ImageOff aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        Removed (retention)
      </span>
    );
  return <span className="text-sm">{state === "retained" ? "Retained" : "No photo"}</span>;
}

export function sourceLabel(source: string, takenOver: boolean) {
  if (source === "photo") return "Photo";
  return takenOver ? "Manual (photo analysis taken over)" : "Manual";
}

/** Store-local time with its zone name, so equal instants in different stores read correctly. */
export function formatInZone(iso: string | null, timeZone: string) {
  if (!iso) return "—";
  // dateStyle/timeStyle cannot be combined with timeZoneName, so name the parts.
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
}
