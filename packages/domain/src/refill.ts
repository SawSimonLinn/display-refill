import { z } from "zod";
import { QuantityOrUnknown, Uuid } from "./primitives";
import { CountReason } from "./scan";
export const RefillSlot = z.strictObject({
  slot_id: Uuid, product_id: Uuid, target: z.int().min(1).max(999),
  threshold: z.int().min(0).max(999).nullable(), current: QuantityOrUnknown,
}).refine((s) => s.threshold === null || s.threshold <= s.target, { path: ["threshold"], message: "must not exceed target" });
export type RefillSlot = z.infer<typeof RefillSlot>;
/** Pinned snapshots only. Unknown propagates within its product and across the display. */
export function calculateRefill(input: readonly RefillSlot[]) {
  const slots = z.array(RefillSlot).min(1).max(100).parse(input);
  if (new Set(slots.map((s) => s.slot_id)).size !== slots.length)
    throw new Error("Duplicate slot");
  const products = new Map<string, number | null>();
  let filled = 0;
  let targets = 0;
  let total: number | null = 0;
  const results = slots.map((s) => {
    const refill = s.current === null ? null : s.threshold === null || s.current <= s.threshold ? Math.max(0, s.target - s.current) : 0;
    const previous = products.has(s.product_id) ? products.get(s.product_id)! : 0;
    products.set(s.product_id, previous === null || refill === null ? null : previous + refill);
    total = total === null || refill === null ? null : total + refill;
    targets += s.target;
    filled += s.current === null ? 0 : Math.min(s.current, s.target);
    return { slot_id: s.slot_id, refill_quantity: refill };
  });
  return { slots: results, products: [...products].map(([product_id, refill_quantity]) => ({ product_id, refill_quantity })), total_refill: total, display_score: total === null ? null : Math.round(100 * filled / targets) };
}
export const SaveCountsRequest = z.strictObject({
  expected_revision: z.int().positive().max(2147483647),
  items: z.array(z.strictObject({ slot_id: Uuid, quantity: z.int().min(0).max(999), verified: z.boolean(), reason: CountReason.nullable().optional() })).min(1).max(100),
}).refine((b) => new Set(b.items.map((i) => i.slot_id)).size === b.items.length, { path: ["items"], message: "duplicate slots" });
export type SaveCountsRequest = z.infer<typeof SaveCountsRequest>;
export const ConfirmScanRequest = z.strictObject({ expected_revision: z.int().positive().max(2147483647) });
export type ConfirmScanRequest = z.infer<typeof ConfirmScanRequest>;
