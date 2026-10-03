import { calculateRefill, type ConfirmScanRequest, type SaveCountsRequest } from "@display-refill/domain";
import { z } from "zod";
import type { Database, Json } from "./database.types";
import { fail, fromDbError, ok } from "./result";
import type { DbClient } from "./supabase";
type ScanRow = Database["public"]["Tables"]["scans"]["Row"];
type SlotRow = Database["public"]["Tables"]["scan_slots"]["Row"];
type Snapshot = ScanRow & {
  scan_slots: SlotRow[];
};
/** The same presenter serves both clients. Finals always come from frozen stored quantities. */
export function scanDetail(row: Snapshot) {
  const slots = [...row.scan_slots].sort((a, b) => a.slot_label_snapshot.localeCompare(b.slot_label_snapshot) || a.pog_slot_id.localeCompare(b.pog_slot_id));
  const final = row.status === "confirmed" || row.status === "completed";
  const calculation = calculateRefill(slots.map((s) => ({ slot_id: s.pog_slot_id, product_id: s.product_id, target: s.target_snapshot, threshold: s.threshold_snapshot, current: s.accepted_quantity })));
  const products = final ? [...new Set(slots.map((s) => s.product_id))].map((product_id) => {
    const group = slots.filter((s) => s.product_id === product_id);
    return { product_id, refill_quantity: group.some((s) => s.refill_quantity === null) ? null : group.reduce((n, s) => n + s.refill_quantity!, 0) };
  }) : calculation.products;
  return {
    scan_id: row.id, display_id: row.display_id, pog_version_id: row.pog_version_id,
    status: row.status, source: row.source, revision: row.revision, created_at: new Date(row.created_at).toISOString(),
    image_available: row.image_path !== null && row.image_deleted_at === null,
    provisional: !final, provisional_total_refill: final ? null : calculation.total_refill,
    total_refill: row.total_refill, display_score: final ? row.display_score : calculation.display_score,
    confirmed_at: row.confirmed_at === null ? null : new Date(row.confirmed_at).toISOString(), completed_at: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
    unresolved_slot_ids: slots.filter((s) => s.accepted_quantity === null || (s.review_required && s.review_state !== "verified")).map((s) => s.pog_slot_id),
    products,
    slots: slots.map((s, index) => ({
      slot_id: s.pog_slot_id, product_id: s.product_id, product_name: s.product_name_snapshot,
      slot_label: s.slot_label_snapshot, target: s.target_snapshot, refill_threshold: s.threshold_snapshot,
      ai_quantity: s.ai_quantity, confidence: s.ai_confidence, flags: s.ai_flags,
      accepted_quantity: s.accepted_quantity, review_required: s.review_required, review_state: s.review_state,
      final_quantity: s.final_quantity, refill_quantity: final ? s.refill_quantity : calculation.slots[index]!.refill_quantity,
    })),
  };
}
export async function getScan(client: DbClient, scanId: string) {
  // One PostgREST statement: counts and revision cannot come from different commits.
  const { data, error } = await client.from("scans").select("*, scan_slots(*)").eq("id", scanId).maybeSingle();
  if (error)
    return fromDbError(error);
  return data ? ok(scanDetail(data)) : fail("NOT_FOUND", "Scan not found.");
}
export async function mutateScan(service: DbClient, actor: string, scanId: string, action: "counts" | "confirm", body: SaveCountsRequest | ConfirmScanRequest, key: string, requestId: string) {
  const { data, error } = await service.rpc("mutate_scan_counts", {
    p_actor: actor, p_scan_id: scanId, p_expected_revision: body.expected_revision,
    p_action: action, p_items: ("items" in body ? body.items : null) as Json,
    p_key: key, p_request_id: requestId,
  });
  if (error) {
    if (error.message === "UNRESOLVED_COUNTS") {
      const ids = z.array(z.uuid()).safeParse(error.details ? JSON.parse(error.details) : []);
      return fail("UNRESOLVED_COUNTS", "Resolve and verify every required slot before confirmation.", { fieldErrors: { slot_ids: ids.success ? ids.data : [] } });
    }
    return fromDbError(error);
  }
  // JSON is produced only by the trusted function, never by the client/model.
  const result = data as unknown as {
    payload: Snapshot;
    replayed: boolean;
  };
  return ok({ detail: scanDetail(result.payload), replayed: result.replayed });
}
