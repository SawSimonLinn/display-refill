import { z } from "zod";
import { Confidence, QuantityOrUnknown, Uuid } from "./primitives";

export const VISION_SCHEMA_VERSION = 1;

export const Alignment = z.enum(["good", "uncertain", "poor"]);
export const ImageFlag = z.enum(["blur", "dark", "glare", "cropped", "occluded"]);
export const SlotFlag = z.enum([
  "occluded",
  "wrong_product",
  "out_of_frame",
  "ambiguous",
  "low_visibility",
]);

/**
 * Raw provider output, schema version 1 (context/vision-contract.md).
 * Strict: unknown top-level or slot fields are rejected. Comparing slot IDs to
 * the pinned set and deriving review requirements is server work (feature 09).
 */
export const VisionResponseV1 = z.strictObject({
  schema_version: z.literal(VISION_SCHEMA_VERSION),
  alignment: Alignment,
  image_flags: z.array(ImageFlag),
  slots: z.array(
    z.strictObject({
      slot_id: Uuid,
      quantity: QuantityOrUnknown,
      confidence: Confidence,
      flags: z.array(SlotFlag),
    }),
  ),
});
export type VisionResponseV1 = z.infer<typeof VisionResponseV1>;

/** Prompt template version sent with every attempt (context/vision-contract.md). */
export const VISION_PROMPT_VERSION = "count-v1";

/**
 * Review-routing policy, stored with every attempt. 0.80 is the provisional
 * routing default from decision D09, not a calibrated accuracy promise.
 */
export const REVIEW_POLICY = { version: "review-v1", confidenceThreshold: 0.8 } as const;

export type SlotFlag = z.infer<typeof SlotFlag>;

export interface NormalizedVisionSlot {
  slot_id: string;
  quantity: number | null;
  confidence: number | null;
  flags: SlotFlag[];
  review_required: boolean;
}

export interface NormalizedVision {
  schema_version: typeof VISION_SCHEMA_VERSION;
  alignment: z.infer<typeof Alignment>;
  image_flags: z.infer<typeof ImageFlag>[];
  slots: NormalizedVisionSlot[];
}

export type NormalizeVisionResult =
  | { ok: true; value: NormalizedVision }
  | { ok: false; code: "UNKNOWN_SLOT_ID" | "DUPLICATE_SLOT_ID" };

/**
 * Compares validated provider output with the pinned slot set and applies the
 * server's review rules. Extra or duplicated IDs reject the whole response;
 * a missing pinned slot becomes unknown and ambiguous, never zero. Uncertain
 * or poor alignment forces every count unknown. Any image flag, slot flag,
 * null count/confidence or confidence below the threshold requires review.
 * Output follows the pinned order.
 */
export function normalizeVisionOutput(
  output: VisionResponseV1,
  pinnedSlotIds: readonly string[],
  confidenceThreshold: number = REVIEW_POLICY.confidenceThreshold,
): NormalizeVisionResult {
  const pinned = new Map(pinnedSlotIds.map((id) => [id.toLowerCase(), id]));
  const seen = new Map<string, VisionResponseV1["slots"][number]>();
  for (const slot of output.slots) {
    const key = slot.slot_id.toLowerCase();
    if (!pinned.has(key)) return { ok: false, code: "UNKNOWN_SLOT_ID" };
    if (seen.has(key)) return { ok: false, code: "DUPLICATE_SLOT_ID" };
    seen.set(key, slot);
  }
  const aligned = output.alignment === "good";
  const imageReview = output.image_flags.length > 0;
  const slots = [...pinned].map(([key, slot_id]): NormalizedVisionSlot => {
    const observed = seen.get(key);
    if (!observed) return { slot_id, quantity: null, confidence: null, flags: ["ambiguous"], review_required: true };
    const quantity = aligned ? observed.quantity : null;
    const flags = [...new Set(observed.flags)];
    const review_required = !aligned || imageReview || quantity === null || observed.confidence === null
      || observed.confidence < confidenceThreshold || flags.length > 0;
    return { slot_id, quantity, confidence: observed.confidence, flags, review_required };
  });
  return { ok: true, value: { schema_version: VISION_SCHEMA_VERSION, alignment: output.alignment, image_flags: [...new Set(output.image_flags)], slots } };
}
