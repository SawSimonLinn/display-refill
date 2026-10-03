import { z } from "zod";

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
