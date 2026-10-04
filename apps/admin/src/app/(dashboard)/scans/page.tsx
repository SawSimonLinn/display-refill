import { ScanHistoryQuery } from "@display-refill/domain";
import { listDisplays, listScanHistory } from "@display-refill/server";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LoadFailed, NextPageLink, PageHeader, PermissionNote, stringParam } from "@/components/catalog/list-parts";
import { formatInZone, PhotoState, STATUS_LABEL, sourceLabel, StatusBadge, SyntheticBadge } from "@/components/scans/scan-labels";
import { dayRange } from "@/lib/zoned-date";
import { sessionCaller } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Scans" };

const field = "min-h-10 rounded-lg border border-input bg-background px-2 text-sm text-foreground";

/**
 * Scan history for review. Managers see the stores they are assigned to and
 * org admins their organization: the same caller-scoped query as
 * `GET /api/v1/scans`, so a filter can only narrow what RLS returns.
 */
export default async function ScansPage(props: PageProps<"/scans">) {
  const session = await requireDashboard("/scans");
  const { me } = session;
  const params = await props.searchParams;
  const storeId = stringParam(params.store_id);
  const displayId = stringParam(params.display_id);
  const status = stringParam(params.status);
  const fromDay = stringParam(params.from);
  const toDay = stringParam(params.to);
  const cursor = stringParam(params.cursor);
  const store = me.stores.find((s) => s.store_id === storeId);
  const timeZone = store?.timezone ?? "UTC";
  const caller = sessionCaller(session);

  const range = dayRange(fromDay, toDay, timeZone);
  const query = "error" in range ? null : ScanHistoryQuery.safeParse({ store_id: storeId, display_id: displayId, status, from: range.from, to: range.to, cursor, limit: 25 });
  const [page, displays] = await Promise.all([
    query?.success ? listScanHistory(caller, me, query.data) : null,
    storeId && store ? listDisplays(caller, me, storeId, { status: store.role === "employee" ? "active" : "all", limit: 100 }) : null,
  ]);
  const keep: Record<string, string> = Object.fromEntries(
    Object.entries({ store_id: storeId, display_id: displayId, status, from: fromDay, to: toDay }).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const filtered = Object.keys(keep).length > 0;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Scans"
        description="Checks in the stores you review, newest first. Recommendations stay provisional until a person confirms the counts; “Refill marked done” is the employee’s attestation, not a stock count."
      />
      <form method="get" action="/scans" aria-label="Filter scans" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Store
          <select name="store_id" defaultValue={storeId ?? ""} className={field}>
            <option value="">All my stores</option>
            {me.stores.map((s) => (
              <option key={s.store_id} value={s.store_id}>
                {s.name} · #{s.store_number}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Display
          <select name="display_id" defaultValue={displayId ?? ""} disabled={!displays?.ok} aria-describedby="display-hint" className={`${field} disabled:opacity-60`}>
            <option value="">All displays</option>
            {displays?.ok
              ? displays.value.items.map((d) => (
                  <option key={d.display_id} value={d.display_id}>
                    {d.name}
                    {d.active ? "" : " (archived)"}
                  </option>
                ))
              : null}
          </select>
          <span id="display-hint" className="text-xs font-normal text-muted-foreground">
            {displays?.ok ? "Displays of the chosen store." : "Choose a store and apply to filter by display."}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Status
          <select name="status" defaultValue={status ?? ""} className={field}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={fromDay} aria-describedby="date-zone" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          To (inclusive)
          <input type="date" name="to" defaultValue={toDay} aria-describedby="date-zone" className={field} />
        </label>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
              Apply filters
            </button>
            {filtered ? (
              <Link href="/scans" className="flex min-h-10 items-center rounded-lg border border-border px-3 text-sm font-medium">
                Clear filters
              </Link>
            ) : null}
          </div>
          <span id="date-zone" className="text-xs text-muted-foreground">
            Dates use {store ? `${store.name}’s time zone (${timeZone})` : "UTC across all stores"}.
          </span>
        </div>
      </form>

      {"error" in range ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          {range.error}
        </p>
      ) : !query?.success ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          These filters are not valid. <Link href="/scans" className="font-medium underline">Clear filters</Link> and try again.
        </p>
      ) : !page?.ok ? (
        page?.code === "NOT_FOUND" ? (
          <EmptyState title={displayId && page.message.startsWith("Display") ? "Display not found" : "Store not found"}>
            It does not exist or is not assigned to you. Choose one of your stores in the filter.
          </EmptyState>
        ) : page?.code === "VALIDATION_FAILED" ? (
          <EmptyState title="This page link has expired">
            <Link href={`/scans?${new URLSearchParams(keep)}`} className="font-medium underline">
              Start again from the newest scans
            </Link>
            .
          </EmptyState>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <LoadFailed what="Scan history" />
            <Link href={`/scans?${new URLSearchParams({ ...keep, ...(cursor ? { cursor } : {}) })}`} className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-medium">
              Try again
            </Link>
          </div>
        )
      ) : page.value.items.length === 0 ? (
        <EmptyState title={filtered ? "No scans match these filters" : "No scans yet"}>
          {filtered ? "Change or clear the filters." : "Checks that employees start on iOS appear here."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {me.stores.length === 0 ? <PermissionNote>You are not assigned to an active store; only archived-store history you can access is shown.</PermissionNote> : null}
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Scans, newest first{cursor ? " (continued)" : ""}</caption>
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="p-3">Started</th>
                  <th scope="col" className="p-3">Store and display</th>
                  <th scope="col" className="p-3">Pinned layout</th>
                  <th scope="col" className="p-3">Source</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3">Confirmed refill</th>
                  <th scope="col" className="p-3">Completion</th>
                  <th scope="col" className="p-3">Photo</th>
                </tr>
              </thead>
              <tbody>
                {page.value.items.map((scan) => (
                  <tr key={scan.scan_id} className="border-b border-border last:border-b-0 align-top">
                    <td className="p-3">
                      <Link href={`/scans/${scan.scan_id}`} className="font-medium underline" aria-label={`Open scan of ${scan.display.name ?? "display"}, started ${formatInZone(scan.created_at, scan.store.timezone)}`}>
                        {formatInZone(scan.created_at, scan.store.timezone)}
                      </Link>
                      <span className="sr-only"> Scan {scan.scan_id}</span>
                    </td>
                    <td className="p-3">
                      <span className="block">{scan.store.name ?? "Store"}</span>
                      <span className="block text-muted-foreground">{scan.display.name ?? "Display"}</span>
                    </td>
                    <td className="p-3">
                      {scan.pog.pog_name ?? "Layout"} · v{scan.pog.version_number ?? "?"}
                    </td>
                    <td className="p-3">
                      <span className="block">{sourceLabel(scan.source, scan.manual_takeover)}</span>
                      {scan.synthetic_analysis ? <SyntheticBadge /> : null}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={scan.status} />
                    </td>
                    <td className="p-3 tabular-nums">{scan.total_refill === null ? <span className="text-muted-foreground">Not confirmed</span> : `Refill ${scan.total_refill}`}</td>
                    <td className="p-3">
                      {scan.completed_at ? (
                        `Attested ${formatInZone(scan.completed_at, scan.store.timezone)}`
                      ) : scan.status === "confirmed" ? (
                        "Not marked done"
                      ) : (
                        <span className="text-muted-foreground">Not applicable</span>
                      )}
                    </td>
                    <td className="p-3">
                      <PhotoState state={scan.image_state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-4">
            {cursor ? (
              <Link href={`/scans?${new URLSearchParams(keep)}`} className="text-sm font-medium underline">
                Back to newest
              </Link>
            ) : null}
            <NextPageLink path="/scans" params={keep} cursor={page.value.next_cursor} />
          </div>
        </div>
      )}
    </section>
  );
}
