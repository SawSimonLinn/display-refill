import { z } from "zod";
import { Uuid } from "./primitives";

/** Scan states from context/scan-lifecycle.md. Transitions are server-owned. */
export const ScanStatus = z.enum([
  "awaiting_upload",
  "queued",
  "processing",
  "needs_review",
  "failed",
  "confirmed",
  "completed",
]);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const ScanSource = z.enum(["photo", "manual"]);
export type ScanSource = z.infer<typeof ScanSource>;

export const CountReason = z.enum([
  "count_corrected",
  "visibility_check",
  "wrong_product",
  "manual_count",
]);
export type CountReason = z.infer<typeof CountReason>;

/**
 * `GET /scans` history filters (Feature 11). Newest first over
 * (created_at, id); `from` is inclusive and `to` exclusive. Filters only
 * narrow what RLS already lets the caller read.
 */
export const ScanHistoryQuery = z
  .strictObject({
    organization_id: Uuid.optional(),
    store_id: Uuid.optional(),
    display_id: Uuid.optional(),
    status: ScanStatus.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), { path: ["to"], error: "must be later than from" });
export type ScanHistoryQuery = z.infer<typeof ScanHistoryQuery>;
