import { Uuid } from "@display-refill/domain";
import { getScanRecord, type ScanRecord } from "@display-refill/server";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, LoadFailed } from "@/components/catalog/list-parts";
import { formatInZone, sourceLabel, StatusBadge, SyntheticBadge } from "@/components/scans/scan-labels";
import { ScanPhoto } from "@/components/scans/scan-photo";
import { pageServiceClient, sessionCaller } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Scan record" };

const REASON: Record<string, string> = {
  count_corrected: "Estimate corrected",
  visibility_check: "Estimate checked as correct",
  wrong_product: "Product mismatch checked",
  manual_count: "Counted by hand",
};
const FLAG: Record<string, string> = {
  occluded: "Units may be hidden",
  wrong_product: "Possibly a different product",
  out_of_frame: "Partly outside the photo",
  ambiguous: "Unclear",
  low_visibility: "Hard to see",
};

type Actor = ScanRecord["created_by"];
const who = (actor: Actor, namesVisible: boolean) =>
  !actor ? "Unknown" : actor.is_you ? "You" : actor.display_name ?? (namesVisible ? "Team member (no display name)" : "Another team member");

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-medium text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One scan's review record: pinned layout, original estimates beside the
 * accepted and final counts, append-only corrections, the frozen
 * confirmation and the employee's completion attestation, kept visibly
 * separate. Authorized by the same caller-scoped read as the API.
 */
export default async function ScanRecordPage(props: PageProps<"/scans/[scan_id]">) {
  const session = await requireDashboard("/scans");
  const { scan_id } = await props.params;
  const back = (
    <Link href="/scans" className="self-start text-sm font-medium underline">
      ← All scans
    </Link>
  );
  const result = Uuid.safeParse(scan_id).success ? await getScanRecord(sessionCaller(session), pageServiceClient(), session.me, scan_id) : null;
  if (!result?.ok) {
    return (
      <section className="flex flex-col gap-6">
        {back}
        {!result || result.code === "NOT_FOUND" ? (
          <EmptyState title="Scan not found">It does not exist or belongs to a store you are not assigned to.</EmptyState>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <LoadFailed what="This scan" />
            <Link href={`/scans/${scan_id}`} className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-medium">
              Try again
            </Link>
          </div>
        )}
      </section>
    );
  }
  const record = result.value;
  const { scan } = record;
  const tz = record.store.timezone;
  const names = record.viewer.staff_names_visible;
  const productName = (id: string) => scan.slots.find((s) => s.product_id === id)?.product_name ?? "Product";
  const final = !scan.provisional;

  return (
    <section className="flex flex-col gap-6">
      {back}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {record.display.name ?? "Display"} · {formatInZone(record.created_at, tz)}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={scan.status} />
          <span className="text-sm text-muted-foreground">
            {record.store.name ?? "Store"} #{record.store.store_number ?? "?"}
          </span>
          {scan.analysis.synthetic ? <SyntheticBadge /> : null}
        </div>
        {scan.analysis.synthetic ? (
          <p className="text-sm text-muted-foreground">Estimates on this scan come from the deterministic test provider. They are not a reading of the photo.</p>
        ) : null}
      </div>

      <Section title="Scan" id="scan-facts">
        <Facts
          items={[
            ["Started", formatInZone(record.created_at, tz)],
            ["Started by", who(record.created_by, names)],
            ["Source", sourceLabel(scan.source, record.manual_takeover !== null)],
            ["Photo validated", formatInZone(record.captured_at, tz)],
            ["Pinned layout", `${record.pog.pog_name ?? "Layout"} · version ${record.pog.version_number ?? "?"}${record.pog.published_at ? ` (published ${formatInZone(record.pog.published_at, tz)})` : ""}`],
            ["Revision", scan.revision],
            ...(record.manual_takeover ? ([["Analysis taken over", `${formatInZone(record.manual_takeover.at, tz)} by ${who(record.manual_takeover.by, names)}`]] as Array<[string, ReactNode]>) : []),
            ...(scan.analysis.failure_code ? ([["Analysis failure", scan.analysis.failure_code]] as Array<[string, ReactNode]>) : []),
            ...(scan.analysis.alignment ? ([["Photo alignment", scan.analysis.alignment]] as Array<[string, ReactNode]>) : []),
            ...(scan.analysis.image_flags.length ? ([["Photo quality flags", scan.analysis.image_flags.join(", ").replaceAll("_", " ")]] as Array<[string, ReactNode]>) : []),
          ]}
        />
        <p className="text-xs text-muted-foreground">Product names, slot labels, targets and triggers below are the values pinned when this scan started; later catalog or layout edits do not change them. Store and display names are current.</p>
      </Section>

      <div className="grid gap-4 md:grid-cols-3">
        <Section title={final ? "Provisional recommendation (superseded)" : "Provisional recommendation"} id="provisional">
          {final ? (
            <p className="text-sm">Replaced by the confirmed refill quantity.</p>
          ) : (
            <>
              <p className="text-2xl font-semibold tabular-nums">{scan.provisional_total_refill === null ? "Unknown" : `Refill ${scan.provisional_total_refill}`}</p>
              <p className="text-sm text-muted-foreground">
                Not confirmed. {scan.unresolved_slot_ids.length > 0 ? `${scan.unresolved_slot_ids.length} slot(s) still need a count or a check.` : "Counts are resolved but not yet confirmed."}
              </p>
            </>
          )}
        </Section>
        <Section title="Confirmed refill quantity" id="confirmed">
          {record.confirmation ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">Refill {record.confirmation.total_refill}</p>
              <p className="text-sm text-muted-foreground">
                Confirmed {formatInZone(record.confirmation.confirmed_at, tz)} by {who(record.confirmation.confirmed_by, names)} at revision {record.confirmation.scan_revision}.
                {record.confirmation.display_score !== null ? ` Display score ${record.confirmation.display_score}.` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm">Not confirmed yet.</p>
          )}
        </Section>
        <Section title="Completion attestation" id="completion">
          {record.completion ? (
            <p className="text-sm">
              {who(record.completion.attested_by, names)} marked the refill done at {formatInZone(record.completion.attested_at, tz)}. This is the employee’s statement; it does not record a new stock count and was not checked by the camera.
            </p>
          ) : (
            <p className="text-sm">{scan.status === "confirmed" ? "Not marked done yet." : "Only confirmed scans can be marked done."}</p>
          )}
        </Section>
      </div>

      <Section title="Slots" id="slots">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <caption className="sr-only">Per-slot estimates, counts and refill quantities</caption>
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="p-2">Slot</th>
                <th scope="col" className="p-2">Product (as pinned)</th>
                <th scope="col" className="p-2">Target</th>
                <th scope="col" className="p-2">Trigger</th>
                <th scope="col" className="p-2">Original estimate</th>
                <th scope="col" className="p-2">Uncertainty</th>
                <th scope="col" className="p-2">Accepted count</th>
                <th scope="col" className="p-2">Final count</th>
                <th scope="col" className="p-2">{final ? "Confirmed refill" : "Provisional refill"}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {scan.slots.map((slot) => (
                <tr key={slot.slot_id} className="border-b border-border last:border-b-0 align-top">
                  <th scope="row" className="p-2 font-medium">{slot.slot_label}</th>
                  <td className="p-2">{slot.product_name}</td>
                  <td className="p-2">{slot.target}</td>
                  <td className="p-2">{slot.refill_threshold === null ? "Always top up" : `${slot.refill_threshold} or fewer`}</td>
                  <td className="p-2">
                    {slot.ai_quantity === null ? "None" : slot.ai_quantity}
                    {slot.confidence !== null ? <span className="block text-xs text-muted-foreground">confidence {slot.confidence.toFixed(2)} (uncalibrated)</span> : null}
                  </td>
                  <td className="p-2">
                    {slot.flags.length ? slot.flags.map((f) => FLAG[f] ?? f).join("; ") : null}
                    {slot.review_required ? <span className="block">Review required · {slot.review_state === "verified" ? "verified by a person" : "not verified"}</span> : <span className="block text-muted-foreground">{slot.review_state === "verified" ? "Verified by a person" : "No review required"}</span>}
                  </td>
                  <td className="p-2">{slot.accepted_quantity ?? "Unknown"}</td>
                  <td className="p-2">{slot.final_quantity ?? <span className="text-muted-foreground">Not confirmed</span>}</td>
                  <td className="p-2">{slot.refill_quantity ?? "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {scan.products.map((p) => (
            <li key={p.product_id}>
              {productName(p.product_id)}: {final ? "refill" : "provisional refill"} <span className="tabular-nums">{p.refill_quantity ?? "unknown"}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Corrections and checks" id="corrections">
        {record.corrections.length === 0 ? (
          <p className="text-sm">No count was saved for this scan yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Append-only correction history, oldest first</caption>
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="p-2">When</th>
                  <th scope="col" className="p-2">Slot</th>
                  <th scope="col" className="p-2">Change</th>
                  <th scope="col" className="p-2">Original estimate</th>
                  <th scope="col" className="p-2">Reason</th>
                  <th scope="col" className="p-2">Verified</th>
                  <th scope="col" className="p-2">By</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {record.corrections.map((c) => (
                  <tr key={c.correction_id} className="border-b border-border last:border-b-0 align-top">
                    <td className="p-2">{formatInZone(c.created_at, tz)} · rev {c.scan_revision}</td>
                    <td className="p-2">{c.slot_label}</td>
                    <td className="p-2">{c.previous_quantity === null ? "Unknown" : c.previous_quantity} → {c.corrected_quantity}</td>
                    <td className="p-2">{c.original_ai_quantity ?? "None"}</td>
                    <td className="p-2">{c.reason ? REASON[c.reason] ?? c.reason : "Not given"}</td>
                    <td className="p-2">{c.verified === null ? "Not recorded (before review tracking)" : c.verified ? "Yes" : "No, saved unverified"}</td>
                    <td className="p-2">{who(c.actor, names)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Photo" id="photo">
        {record.image.state === "retained" ? (
          <ScanPhoto scanId={scan.scan_id} alt={`Photo of ${record.display.name ?? "the display"} taken for this scan`} />
        ) : record.image.state === "deleted" ? (
          <p role="status" className="text-sm">
            Photo removed under retention policy{record.image.deleted_at ? ` on ${formatInZone(record.image.deleted_at, tz)}` : ""}. Counts and review history remain.
          </p>
        ) : (
          <p className="text-sm">{scan.source === "manual" && !record.manual_takeover ? "Manual check: no photo was taken." : "No validated photo was stored for this scan."}</p>
        )}
      </Section>

      {record.analysis_attempts ? (
        <Section title="Analysis attempts" id="attempts">
          {record.analysis_attempts.length === 0 ? (
            <p className="text-sm">No analysis ran for this scan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="sr-only">Provider, model and prompt versions for each analysis attempt</caption>
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-2">Attempt</th>
                    <th scope="col" className="p-2">Provider / model</th>
                    <th scope="col" className="p-2">Prompt · schema · policy</th>
                    <th scope="col" className="p-2">Outcome</th>
                    <th scope="col" className="p-2">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {record.analysis_attempts.map((a) => (
                    <tr key={`${a.generation}-${a.attempt_number}`} className="border-b border-border last:border-b-0">
                      <td className="p-2 tabular-nums">Generation {a.generation}, attempt {a.attempt_number}</td>
                      <td className="p-2">{a.provider} / {a.model}</td>
                      <td className="p-2">{a.prompt_version} · {a.schema_version} · {a.policy_version ?? "—"}{a.confidence_threshold !== null ? ` (cutoff ${a.confidence_threshold})` : ""}</td>
                      <td className="p-2">{a.outcome}{a.error_code ? ` (${a.error_code})` : ""}</td>
                      <td className="p-2">{formatInZone(a.started_at, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Shown to store managers and organization admins. Usage, costs and request details stay on the server.</p>
        </Section>
      ) : null}
    </section>
  );
}
