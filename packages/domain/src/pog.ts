import { z } from "zod";
import { hasCoordinatePrecision, isInsideCrop, type Rect, rectsOverlap } from "./pog-geometry";
import { Rfc3339Utc, Uuid } from "./primitives";

/**
 * POG builder and publication contracts (feature 05). Request schemas are
 * strict. Organization and POG ownership always come from the stored version.
 */

export const MAX_SLOTS = 100;

/** Reference image limits (storage-and-retention.md). */
export const REFERENCE_IMAGE = {
  contentType: "image/jpeg",
  maxBytes: 10 * 1024 * 1024,
  /** Largest accepted upload edge and area, before cropping. */
  maxEdge: 4096,
  maxPixels: 16_000_000,
  /** The stored canonical crop is scaled down to this long edge. */
  outputLongEdge: 2048,
  /** Smallest accepted crop edge in pixels of the upright upload. */
  minCropEdge: 64,
  /** Signed download links (auth-and-permissions.md). */
  accessSeconds: 300,
} as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: "is required" })
    .max(max, { error: `must be at most ${max} characters` });

const ExpectedRevision = z.number().int().positive();

const Coordinate = z
  .number({ error: "must be a number" })
  .refine(Number.isFinite, { error: "must be a number" })
  .refine(hasCoordinatePrecision, { error: "must have at most 6 decimal places" });

/** Rectangle normalized to the upright canonical crop (see pog-geometry.ts). */
export const NormalizedRect = z
  .strictObject({ x: Coordinate, y: Coordinate, width: Coordinate, height: Coordinate })
  .refine(isInsideCrop, { error: "must lie inside the image: 0 ≤ x, y < 1; width and height > 0; x + width ≤ 1; y + height ≤ 1" });
export type NormalizedRect = z.infer<typeof NormalizedRect>;

const SlotFields = {
  /** Keeps the slot's ID when it already belongs to this draft. */
  slot_id: Uuid.optional(),
  label: text(40),
  product_id: Uuid,
  x: Coordinate,
  y: Coordinate,
  width: Coordinate,
  height: Coordinate,
  target_quantity: z.int({ error: "must be a whole number" }).min(1, { error: "must be 1 to 999" }).max(999, { error: "must be 1 to 999" }),
  /** Inclusive refill trigger; null means always top up to target. */
  refill_threshold: z.int({ error: "must be a whole number" }).min(0, { error: "must be 0 or more" }).max(999).nullable(),
  sort_order: z.int({ error: "must be a whole number" }).min(0).max(999),
};

export const PogSlotInput = z.strictObject(SlotFields).superRefine((slot, ctx) => {
  if (!isInsideCrop(slot)) ctx.addIssue({ code: "custom", path: ["width"], message: "the rectangle must lie inside the image (x + width ≤ 1, y + height ≤ 1)" });
  if (slot.refill_threshold !== null && slot.refill_threshold > slot.target_quantity) {
    ctx.addIssue({ code: "custom", path: ["refill_threshold"], message: "must not exceed the target" });
  }
});
export type PogSlotInput = z.infer<typeof PogSlotInput>;

/** PUT /pog-versions/:id/slots — the complete slot set of a draft. */
export const ReplaceSlotsRequest = z
  .strictObject({
    expected_revision: ExpectedRevision,
    slots: z.array(PogSlotInput).max(MAX_SLOTS, { error: `at most ${MAX_SLOTS} slots` }),
    /** Confirms every slot was reviewed against a replaced reference image. */
    confirm_coordinates: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Map<string, number>();
    body.slots.forEach((slot, i) => {
      const key = slot.label.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["slots", i, "label"], message: `is already used by slot ${seen.get(key)! + 1}` });
      else seen.set(key, i);
    });
  });
export type ReplaceSlotsRequest = z.infer<typeof ReplaceSlotsRequest>;

/** POST /pogs/:pog_id/versions — next draft: a copy of a published version, or blank (null). */
export const CreatePogVersionRequest = z.strictObject({ source_version_id: Uuid.nullable() });
export type CreatePogVersionRequest = z.infer<typeof CreatePogVersionRequest>;

export const PublishPogVersionRequest = z.strictObject({ expected_revision: ExpectedRevision });
export type PublishPogVersionRequest = z.infer<typeof PublishPogVersionRequest>;

/** Clockwise quarter turns applied after EXIF orientation. */
export const ImageRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)], { error: "must be 0, 90, 180 or 270" });
export type ImageRotation = z.infer<typeof ImageRotation>;

/**
 * POST /pog-versions/:id/finalize-image. `crop` selects the display bounds,
 * normalized to the upload after EXIF orientation and `rotation`; the crop
 * becomes the canonical reference every slot coordinate refers to.
 */
export const FinalizePogImageRequest = z.strictObject({
  upload_id: Uuid,
  expected_revision: ExpectedRevision,
  rotation: ImageRotation.default(0),
  crop: NormalizedRect.default({ x: 0, y: 0, width: 1, height: 1 }),
});
export type FinalizePogImageRequest = z.infer<typeof FinalizePogImageRequest>;

/** Response of POST /pog-versions/:id/upload-intent. `upload_url` requires the actor’s session; the exact-path intent expires after ten minutes. */
export const PogUploadIntent = z.strictObject({
  upload_id: Uuid,
  bucket: z.literal("pog-images"),
  object_path: z.string(),
  upload_url: z.url(),
  upload_method: z.literal("PUT"),
  content_type: z.literal(REFERENCE_IMAGE.contentType),
  max_bytes: z.number().int().positive(),
  expires_at: Rfc3339Utc,
});
export type PogUploadIntent = z.infer<typeof PogUploadIntent>;

/** Response of POST /pog-versions/:id/image-access. Expires after five minutes; never persist it. */
export const PogImageAccess = z.strictObject({
  url: z.url(),
  expires_at: Rfc3339Utc,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PogImageAccess = z.infer<typeof PogImageAccess>;

export const PogVersionSlot = z.strictObject({
  slot_id: Uuid,
  label: z.string(),
  product_id: Uuid,
  product_name: z.string(),
  product_short_name: z.string(),
  product_active: z.boolean(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  target_quantity: z.number().int(),
  refill_threshold: z.number().int().nullable(),
  sort_order: z.number().int(),
});
export type PogVersionSlot = z.infer<typeof PogVersionSlot>;

export const LayoutIssueCode = z.enum([
  "no_reference",
  "needs_review",
  "no_slots",
  "too_many_slots",
  "label_missing",
  "label_duplicate",
  "product_missing",
  "product_inactive",
  "bounds",
  "overlap",
  "target",
  "threshold",
]);
export type LayoutIssueCode = z.infer<typeof LayoutIssueCode>;

export const LayoutIssue = z.strictObject({
  code: LayoutIssueCode,
  message: z.string(),
  /** Slots involved (keys are slot IDs in API responses). */
  slot_keys: z.array(z.string()),
  /** "save": the server rejects the draft save; "publish": only publication is refused. */
  blocks: z.enum(["save", "publish"]),
});
export type LayoutIssue = z.infer<typeof LayoutIssue>;

export const PogVersionDetail = z.strictObject({
  pog_version_id: Uuid,
  pog_id: Uuid,
  organization_id: Uuid,
  pog_name: z.string(),
  pog_archived: z.boolean(),
  version_number: z.number().int().positive(),
  state: z.enum(["draft", "published"]),
  /** Concurrency token for slot saves, image changes and publication. */
  revision: z.number().int().positive(),
  created_at: Rfc3339Utc,
  updated_at: Rfc3339Utc,
  published_at: Rfc3339Utc.nullable(),
  source_version_id: Uuid.nullable(),
  /** Canonical crop dimensions of the validated reference; null until one is finalized. */
  reference: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive(), validated_at: Rfc3339Utc }).nullable(),
  /** The reference was replaced after slots were drawn; publication waits for a confirmed review. */
  slots_need_review: z.boolean(),
  slots: z.array(PogVersionSlot),
  /** The POG's open draft, when the caller can see it (admins). */
  draft_version_id: Uuid.nullable(),
  /** Why publication would be refused right now (drafts only; empty for published versions). */
  publish_blockers: z.array(LayoutIssue),
});
export type PogVersionDetail = z.infer<typeof PogVersionDetail>;

// ---------------------------------------------------------------------------
// Layout validation shared by the editor and the API. The database rechecks
// every rule when it saves or publishes; this gives specific messages first.
// ---------------------------------------------------------------------------

export interface LayoutSlot extends Rect {
  /** Stable identity for messages and highlighting (slot ID or a client key). */
  key: string;
  label: string;
  product_id: string | null;
  product_active: boolean;
  target_quantity: number | null;
  refill_threshold: number | null;
}

const name = (s: LayoutSlot, i: number) => (s.label.trim() ? `Slot ${s.label.trim()}` : `Slot ${i + 1}`);
const isWhole = (v: number | null): v is number => v !== null && Number.isInteger(v);

/** Every reason a layout cannot be saved or published, in display order. */
export function layoutIssues(slots: LayoutSlot[], context: { hasReference: boolean; needsReview: boolean }): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const add = (code: LayoutIssueCode, message: string, keys: string[], blocks: "save" | "publish") => issues.push({ code, message, slot_keys: keys, blocks });

  if (!context.hasReference) add("no_reference", "Upload and validate a reference image.", [], "publish");
  if (context.needsReview) add("needs_review", "The reference image was replaced. Check every slot against it, then save with “I checked every slot”.", [], "publish");
  if (slots.length === 0) add("no_slots", "Add at least one slot.", [], "publish");
  if (slots.length > MAX_SLOTS) add("too_many_slots", `A version can have at most ${MAX_SLOTS} slots.`, [], "save");

  const labels = new Map<string, LayoutSlot>();
  slots.forEach((s, i) => {
    const label = s.label.trim();
    if (!label) add("label_missing", `${name(s, i)} needs a label.`, [s.key], "save");
    else if (label.length > 40) add("label_missing", `${name(s, i)}: the label must be at most 40 characters.`, [s.key], "save");
    else {
      const other = labels.get(label.toLowerCase());
      if (other) add("label_duplicate", `Label ${label} is used by more than one slot.`, [other.key, s.key], "save");
      else labels.set(label.toLowerCase(), s);
    }
    if (!s.product_id) add("product_missing", `${name(s, i)} needs a product.`, [s.key], "save");
    else if (!s.product_active) add("product_inactive", `${name(s, i)} uses an archived product. Choose an active product before publishing.`, [s.key], "publish");
    if (![s.x, s.y, s.width, s.height].every(hasCoordinatePrecision) || !isInsideCrop(s)) {
      add("bounds", `${name(s, i)} must lie inside the reference image.`, [s.key], "save");
    }
    if (!isWhole(s.target_quantity) || s.target_quantity < 1 || s.target_quantity > 999) add("target", `${name(s, i)}: target must be a whole number from 1 to 999.`, [s.key], "save");
    if (s.refill_threshold !== null) {
      if (!isWhole(s.refill_threshold) || s.refill_threshold < 0) add("threshold", `${name(s, i)}: refill trigger must be a whole number, 0 or more.`, [s.key], "save");
      else if (isWhole(s.target_quantity) && s.refill_threshold > s.target_quantity) add("threshold", `${name(s, i)}: refill trigger must not exceed the target.`, [s.key], "save");
    }
  });

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (isInsideCrop(a) && isInsideCrop(b) && rectsOverlap(a, b)) add("overlap", `${name(a, i)} and ${name(b, j)} overlap.`, [a.key, b.key], "publish");
    }
  }
  return issues;
}
