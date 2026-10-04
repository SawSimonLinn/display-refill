import type { Me, ScanHistoryQuery } from "@display-refill/domain";
import { decodeCursor, encodeCursor, type Page } from "./catalog";
import type { Database } from "./database.types";
import { fail, fromDbError, ok, type ServiceResult } from "./result";
import { scanDetail } from "./scans";
import type { DbClient } from "./supabase";

/**
 * Scan history and the review record (Feature 11).
 *
 * The list, the record and image access all start with the same
 * caller-scoped read of `scans`, so RLS (assigned stores; organization for
 * admins) is the single authorization boundary. The service client is used
 * only afterwards, for rows of that one visible scan: actor display names
 * and analysis attempt metadata for the store's managers and org admins.
 *
 * Product names, slot labels, targets, thresholds and the pinned version
 * number come from scan snapshots and the immutable published version.
 * Store, display and POG template names are current labels (decision D74).
 */

type ScanRow = Database["public"]["Tables"]["scans"]["Row"];
type SlotRow = Database["public"]["Tables"]["scan_slots"]["Row"];
type CorrectionRow = Database["public"]["Tables"]["scan_corrections"]["Row"];
type ConfirmationRow = Database["public"]["Tables"]["scan_confirmations"]["Row"];
type Labels = {
  stores: { name: string; store_number: string; timezone: string } | null;
  displays: { name: string } | null;
  pog_versions: { version_number: number; published_at: string | null; pogs: { name: string } | null } | null;
};
type ListRow = Pick<
  ScanRow,
  | "id" | "organization_id" | "store_id" | "display_id" | "pog_version_id" | "created_by" | "source" | "status" | "image_path"
  | "image_deleted_at" | "captured_at" | "confirmed_at" | "completed_at" | "total_refill" | "display_score" | "created_at"
  | "manual_takeover_at" | "ai_summary" | "failure_code"
> & Labels;
type RecordRow = ScanRow & Labels & {
  scan_slots: SlotRow[];
  scan_corrections: CorrectionRow[];
  scan_confirmations: ConfirmationRow | ConfirmationRow[] | null;
};

const LABELS = "stores(name, store_number, timezone), displays(name), pog_versions(version_number, published_at, pogs(name))";
const LIST_COLUMNS = `id, organization_id, store_id, display_id, pog_version_id, created_by, source, status, image_path, image_deleted_at, captured_at, confirmed_at, completed_at, total_refill, display_score, created_at, manual_takeover_at, ai_summary, failure_code, ${LABELS}`;
const RECORD_COLUMNS = `*, scan_slots(*), scan_corrections(*), scan_confirmations(*), ${LABELS}`;

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/** none: never had a photo (manual); retained: readable now; deleted: removed under retention, metadata kept. */
export type ImageState = "none" | "retained" | "deleted";
const imageState = (row: Pick<ScanRow, "image_path" | "image_deleted_at">): ImageState =>
  row.image_deleted_at !== null ? "deleted" : row.image_path === null ? "none" : "retained";

const finalStatus = (status: string) => status === "confirmed" || status === "completed";

function labels(row: Pick<ScanRow, "store_id" | "display_id" | "pog_version_id"> & Labels) {
  return {
    store: { store_id: row.store_id, name: row.stores?.name ?? null, store_number: row.stores?.store_number ?? null, timezone: row.stores?.timezone ?? "UTC" },
    display: { display_id: row.display_id, name: row.displays?.name ?? null },
    pog: {
      pog_version_id: row.pog_version_id,
      version_number: row.pog_versions?.version_number ?? null,
      pog_name: row.pog_versions?.pogs?.name ?? null,
      published_at: iso(row.pog_versions?.published_at ?? null),
    },
  };
}

const syntheticAnalysis = (summary: ScanRow["ai_summary"]) =>
  summary !== null && typeof summary === "object" && !Array.isArray(summary) && summary.provider === "mock";

/** One history row. Refill totals appear only once confirmed; completion is an attestation time, not a stock reading. */
export function historyItem(row: ListRow, me: Pick<Me, "user_id">) {
  const final = finalStatus(row.status);
  return {
    scan_id: row.id,
    organization_id: row.organization_id,
    ...labels(row),
    status: row.status,
    source: row.source,
    created_at: iso(row.created_at)!,
    captured_at: iso(row.captured_at),
    confirmed_at: iso(row.confirmed_at),
    completed_at: iso(row.completed_at),
    total_refill: final ? row.total_refill : null,
    display_score: final ? row.display_score : null,
    image_state: imageState(row),
    synthetic_analysis: syntheticAnalysis(row.ai_summary),
    manual_takeover: row.manual_takeover_at !== null,
    failure_code: row.failure_code,
    created_by_you: row.created_by === me.user_id,
  };
}
export type ScanHistoryItem = ReturnType<typeof historyItem>;

/**
 * Newest first over (created_at, id). The cursor holds Postgres's exact
 * microsecond timestamp text, so rows sharing a timestamp are split by id
 * and never repeated or skipped across pages.
 */
export async function listScanHistory(caller: DbClient, me: Me, q: ScanHistoryQuery): Promise<ServiceResult<Page<ScanHistoryItem>>> {
  if (q.organization_id && !me.organizations.some((o) => o.organization_id === q.organization_id)) return fail("NOT_FOUND", "Organization not found.");
  const position = q.cursor === undefined ? null : decodeCursor(q.cursor);
  if (q.cursor !== undefined && !position) return fail("VALIDATION_FAILED", "The request contains invalid values.", { fieldErrors: { cursor: ["is not a valid cursor"] } });
  // A filter naming something the caller cannot read is 404, exactly like the record itself.
  if (q.store_id) {
    const store = await caller.from("stores").select("id").eq("id", q.store_id).maybeSingle();
    if (store.error) return fromDbError(store.error);
    if (!store.data) return fail("NOT_FOUND", "Store not found.");
  }
  if (q.display_id) {
    const display = await caller.from("displays").select("id").eq("id", q.display_id).maybeSingle();
    if (display.error) return fromDbError(display.error);
    if (!display.data) return fail("NOT_FOUND", "Display not found.");
  }
  let query = caller.from("scans").select(LIST_COLUMNS).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(q.limit + 1);
  if (q.organization_id) query = query.eq("organization_id", q.organization_id);
  if (q.store_id) query = query.eq("store_id", q.store_id);
  if (q.display_id) query = query.eq("display_id", q.display_id);
  if (q.status) query = query.eq("status", q.status);
  if (q.from) query = query.gte("created_at", new Date(q.from).toISOString());
  if (q.to) query = query.lt("created_at", new Date(q.to).toISOString());
  if (position) {
    const t = `"${position.created_at}"`;
    query = query.or(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${position.id})`);
  }
  const { data, error } = await query;
  if (error) return fromDbError(error);
  const rows = data as unknown as ListRow[];
  const items = rows.slice(0, q.limit);
  return ok({ items: items.map((r) => historyItem(r, me)), next_cursor: rows.length > q.limit ? encodeCursor(items[items.length - 1]!) : null });
}

/** Org admins and managers of the scan's store review staff names and analysis metadata; employees see their store's evidence only. */
const reviewsStore = (me: Me, row: Pick<ScanRow, "organization_id" | "store_id">) =>
  me.capabilities.admin_organization_ids.includes(row.organization_id) || me.stores.some((s) => s.store_id === row.store_id && s.role !== "employee");

/**
 * The review record of one scan: the same detail as `GET /scans/:id`
 * (`scan`), its pinned context, append-only corrections, the frozen
 * confirmation, the completion attestation and photo retention state.
 */
export async function getScanRecord(caller: DbClient, service: DbClient, me: Me, scanId: string) {
  const { data, error } = await caller.from("scans").select(RECORD_COLUMNS).eq("id", scanId).maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail("NOT_FOUND", "Scan not found.");
  const row = data as unknown as RecordRow;
  const reviewer = reviewsStore(me, row);
  const confirmation = Array.isArray(row.scan_confirmations) ? row.scan_confirmations[0] ?? null : row.scan_confirmations;
  const slots = new Map(row.scan_slots.map((s) => [s.id, s]));
  const label = (c: CorrectionRow) => slots.get(c.scan_slot_id)?.slot_label_snapshot ?? "";
  // One save writes several rows with the same timestamp: order those by slot label, then id.
  const corrections = [...row.scan_corrections].sort((a, b) => a.created_at.localeCompare(b.created_at) || label(a).localeCompare(label(b)) || a.id.localeCompare(b.id));

  const names = new Map<string, string | null>();
  if (reviewer) {
    const ids = [...new Set([row.created_by, row.completed_by, row.manual_takeover_by, confirmation?.confirmed_by, ...corrections.map((c) => c.actor_id)].filter((v): v is string => !!v))];
    const profiles = await service.from("profiles").select("user_id, display_name").in("user_id", ids);
    if (profiles.error) return fromDbError(profiles.error);
    for (const p of profiles.data) names.set(p.user_id, p.display_name.trim() || null);
  }
  const actor = (id: string | null | undefined) =>
    id ? { user_id: id, is_you: id === me.user_id, display_name: reviewer ? names.get(id) ?? null : null } : null;

  let attempts = null;
  if (reviewer) {
    // Versions and outcomes only: no usage, lease tokens, input hashes or normalized responses.
    const result = await service
      .from("scan_attempts")
      .select("generation, attempt_number, provider, model, prompt_version, schema_version, policy_version, confidence_threshold, outcome, error_code, started_at, ended_at")
      .eq("scan_id", row.id)
      .eq("organization_id", row.organization_id)
      .order("generation")
      .order("attempt_number");
    if (result.error) return fromDbError(result.error);
    attempts = result.data.map((a) => ({
      ...a,
      confidence_threshold: a.confidence_threshold === null ? null : Number(a.confidence_threshold),
      started_at: iso(a.started_at),
      ended_at: iso(a.ended_at),
    }));
  }

  return ok({
    scan: scanDetail(row),
    ...labels(row),
    created_at: iso(row.created_at)!,
    captured_at: iso(row.captured_at),
    created_by: actor(row.created_by),
    manual_takeover: row.manual_takeover_at ? { at: iso(row.manual_takeover_at), by: actor(row.manual_takeover_by) } : null,
    image: { state: imageState(row), deleted_at: iso(row.image_deleted_at) },
    corrections: corrections.map((c) => {
      const slot = slots.get(c.scan_slot_id);
      return {
        correction_id: c.id,
        slot_id: slot?.pog_slot_id ?? null,
        slot_label: slot?.slot_label_snapshot ?? null,
        product_name: slot?.product_name_snapshot ?? null,
        previous_quantity: c.previous_quantity,
        corrected_quantity: c.corrected_quantity,
        original_ai_quantity: c.original_ai_quantity,
        reason: c.reason,
        verified: c.verified,
        scan_revision: c.scan_revision,
        created_at: iso(c.created_at),
        actor: actor(c.actor_id),
      };
    }),
    confirmation: confirmation
      ? { confirmed_at: iso(confirmation.confirmed_at), confirmed_by: actor(confirmation.confirmed_by), scan_revision: confirmation.scan_revision, total_refill: confirmation.total_refill, display_score: confirmation.display_score }
      : null,
    completion: row.completed_at ? { attested_at: iso(row.completed_at), attested_by: actor(row.completed_by) } : null,
    analysis_attempts: attempts,
    viewer: { staff_names_visible: reviewer, analysis_metadata_visible: reviewer },
  });
}
export type ScanRecord = Extract<Awaited<ReturnType<typeof getScanRecord>>, { ok: true }>["value"];

export const IMAGE_DELETED_MESSAGE = "Photo removed under retention policy. Counts and review history remain.";

/**
 * Five-minute signed link to a scan's validated photo, after the same
 * caller-scoped read as the list and record. Links are never stored or logged.
 */
export async function scanImageAccess(caller: DbClient, service: DbClient, scanId: string): Promise<ServiceResult<{ url: string; expires_at: string }>> {
  const scan = await caller.from("scans").select("image_path, image_deleted_at").eq("id", scanId).maybeSingle();
  if (scan.error) return fromDbError(scan.error);
  if (!scan.data) return fail("NOT_FOUND", "Scan not found.");
  if (scan.data.image_deleted_at !== null) return fail("IMAGE_DELETED", IMAGE_DELETED_MESSAGE);
  if (scan.data.image_path === null) return fail("NOT_FOUND", "This scan has no photo.");
  const signed = await service.storage.from("display-scans").createSignedUrl(scan.data.image_path, 300);
  if (signed.error) {
    const status = (signed.error as { status?: number }).status;
    return status === 400 || status === 404 ? fail("NOT_FOUND", "The photo file is unavailable.") : fail("DEPENDENCY_UNAVAILABLE", "Photo unavailable. Try again shortly.");
  }
  return ok({ url: signed.data.signedUrl, expires_at: new Date(Date.now() + 300_000).toISOString() });
}
