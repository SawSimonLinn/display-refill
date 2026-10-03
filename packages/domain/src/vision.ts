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
