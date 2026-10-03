import { z } from "zod";

/** UUID identifiers are used for every public resource ID. */
export const Uuid = z.uuid();

/** UTC RFC3339 timestamp as sent over HTTP. Offsets other than Z are rejected. */
export const Rfc3339Utc = z.iso.datetime();

/**
 * A count of containers. Integers only, 0–999. `null` means unknown and is
 * never interchangeable with an observed zero.
 */
export const Quantity = z.int().min(0).max(999);
export const QuantityOrUnknown = Quantity.nullable();

/** Model self-reported confidence, finite 0–1, or null when absent. */
export const Confidence = z.number().min(0).max(1).nullable();
