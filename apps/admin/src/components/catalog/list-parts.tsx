import type { ListStatus } from "@display-refill/domain";
import { Archive, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const STATUS_LABEL: Record<ListStatus, string> = { active: "Active", archived: "Archived", all: "All" };

/** Active / Archived / All links. Shown only to callers allowed to see archived records. */
export function StatusFilter({ path, current, params = {} }: { path: string; current: ListStatus; params?: Record<string, string> }) {
  return (
    <nav aria-label="Filter by status" className="flex gap-1">
      {(Object.keys(STATUS_LABEL) as ListStatus[]).map((status) => {
        const query = new URLSearchParams({ ...params, ...(status === "active" ? {} : { status }) }).toString();
        const active = status === current;
        return (
          <Link
            key={status}
            href={query ? `${path}?${query}` : path}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
          >
            {STATUS_LABEL[status]}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageHeader({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** Empty list: says what is missing and the next action this caller may take. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-card p-5">
      <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** Permission explanation for actions the caller cannot take (the API refuses them regardless). */
export function PermissionNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
      <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </p>
  );
}

export function LoadFailed({ what }: { what: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
      {what} could not be loaded. Reload the page to try again.
    </p>
  );
}

/** Status is text plus icon, never color alone. */
export function ArchivedBadge({ label = "Archived" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Archive aria-hidden className="size-3" />
      {label}
    </span>
  );
}

export function NextPageLink({ path, params, cursor }: { path: string; params: Record<string, string>; cursor: string | null }) {
  if (!cursor) return null;
  return (
    <Link href={`${path}?${new URLSearchParams({ ...params, cursor }).toString()}`} className="self-start text-sm font-medium underline">
      Show more
    </Link>
  );
}

/** Reads `?status=` for pages; anything unknown means the default (active). */
export function statusParam(value: string | string[] | undefined): ListStatus {
  return value === "archived" || value === "all" ? value : "active";
}

export function stringParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;
}
