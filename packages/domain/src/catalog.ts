import { z } from "zod";
import { Rfc3339Utc, Uuid } from "./primitives";

/**
 * Store, product, POG identity and display contracts (feature 04). Request
 * schemas are strict: unknown fields (including actor or organization fields
 * a route does not accept) are rejected. Organization and store ownership of
 * an existing resource always comes from the stored row, never the request.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: "is required" })
    .max(max, { error: `must be at most ${max} characters` });

/** Optional product code: blank is sent as null. */
const code = text(64).nullable();

export const Upc = z.string().trim().regex(/^[0-9]{6,14}$/, { error: "must be 6 to 14 digits" });

/** IANA zone name shape; the database checks it against its tz list. */
export const TimeZoneName = z
  .string()
  .trim()
  .min(1, { error: "is required" })
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/, { error: "must be an IANA time zone such as America/Los_Angeles" });

const ExpectedRevision = z.number().int().positive();

/** Status filter for lists. Archived rows are visible only where the caller may manage them. */
export const ListStatus = z.enum(["active", "archived", "all"]);
export type ListStatus = z.infer<typeof ListStatus>;

export const LIST_DEFAULT_LIMIT = 25;
export const LIST_MAX_LIMIT = 100;

export function page<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), next_cursor: z.string().nullable() });
}

/** Lists scoped to one organization (products, POGs) also name it. */
export function organizationPage<T extends z.ZodType>(item: T) {
  return z.strictObject({ organization_id: Uuid, items: z.array(item), next_cursor: z.string().nullable() });
}

const atLeastOne = <T extends Record<string, unknown>>(keys: Array<keyof T & string>) => ({
  check: (b: T) => keys.some((k) => b[k] !== undefined),
  message: `change at least one of ${keys.join(", ")}`,
});

// ---------------------------------------------------------------------------
// Stores (admin)
// ---------------------------------------------------------------------------

export const Store = z.strictObject({
  store_id: Uuid,
  organization_id: Uuid,
  name: z.string(),
  store_number: z.string(),
  timezone: z.string(),
  active: z.boolean(),
  revision: z.number().int().positive(),
  created_at: Rfc3339Utc,
  updated_at: Rfc3339Utc,
});
export type Store = z.infer<typeof Store>;

export const CreateStoreRequest = z.strictObject({
  organization_id: Uuid.optional(),
  name: text(200),
  store_number: text(50),
  timezone: TimeZoneName,
});
export type CreateStoreRequest = z.infer<typeof CreateStoreRequest>;

const storeChange = atLeastOne<{ name?: string; store_number?: string; timezone?: string; active?: boolean }>(["name", "store_number", "timezone", "active"]);
export const UpdateStoreRequest = z
  .strictObject({
    expected_revision: ExpectedRevision,
    name: text(200).optional(),
    store_number: text(50).optional(),
    timezone: TimeZoneName.optional(),
    active: z.boolean().optional(),
  })
  .refine(storeChange.check, { error: storeChange.message });
export type UpdateStoreRequest = z.infer<typeof UpdateStoreRequest>;

// ---------------------------------------------------------------------------
// Products (admin; managers read the organization catalog)
// ---------------------------------------------------------------------------

export const Product = z.strictObject({
  product_id: Uuid,
  organization_id: Uuid,
  name: z.string(),
  short_name: z.string(),
  category: z.string(),
  container_type: z.string(),
  sku: z.string().nullable(),
  plu: z.string().nullable(),
  upc: z.string().nullable(),
  active: z.boolean(),
  revision: z.number().int().positive(),
  created_at: Rfc3339Utc,
  updated_at: Rfc3339Utc,
});
export type Product = z.infer<typeof Product>;

export const CreateProductRequest = z.strictObject({
  organization_id: Uuid.optional(),
  name: text(200),
  short_name: text(60),
  category: text(100),
  container_type: text(100),
  sku: code.optional(),
  plu: code.optional(),
  upc: Upc.nullable().optional(),
});
export type CreateProductRequest = z.infer<typeof CreateProductRequest>;

type ProductChange = { name?: string; short_name?: string; category?: string; container_type?: string; sku?: string | null; plu?: string | null; upc?: string | null; active?: boolean };
const productChange = atLeastOne<ProductChange>(["name", "short_name", "category", "container_type", "sku", "plu", "upc", "active"]);
export const UpdateProductRequest = z
  .strictObject({
    expected_revision: ExpectedRevision,
    name: text(200).optional(),
    short_name: text(60).optional(),
    category: text(100).optional(),
    container_type: text(100).optional(),
    sku: code.optional(),
    plu: code.optional(),
    upc: Upc.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(productChange.check, { error: productChange.message });
export type UpdateProductRequest = z.infer<typeof UpdateProductRequest>;

// ---------------------------------------------------------------------------
// POG identities (admin). Slots, images and publication are feature 05.
// ---------------------------------------------------------------------------

export const PogVersionState = z.enum(["draft", "published"]);

/** Store section a POG is for; the same four sections as production. */
export const PogKind = z.enum(["fruit_mobile", "salad_mobile", "fruit_case", "veggie_case"]);
export type PogKind = z.infer<typeof PogKind>;

export const PogVersionSummary = z.strictObject({
  pog_version_id: Uuid,
  version_number: z.number().int().positive(),
  state: PogVersionState,
  published_at: Rfc3339Utc.nullable(),
  slot_count: z.number().int().nonnegative(),
});
export type PogVersionSummary = z.infer<typeof PogVersionSummary>;

export const Pog = z.strictObject({
  pog_id: Uuid,
  organization_id: Uuid,
  name: z.string(),
  /** Null only for POGs created before kinds existed. */
  kind: PogKind.nullable(),
  archived: z.boolean(),
  revision: z.number().int().positive(),
  created_at: Rfc3339Utc,
  updated_at: Rfc3339Utc,
  /** Versions visible to the caller: admins see drafts, managers published only. Newest first. */
  versions: z.array(PogVersionSummary),
});
export type Pog = z.infer<typeof Pog>;

export const CreatePogRequest = z.strictObject({
  organization_id: Uuid.optional(),
  name: text(200),
  kind: PogKind,
});
export type CreatePogRequest = z.infer<typeof CreatePogRequest>;

const pogChange = atLeastOne<{ name?: string; kind?: PogKind; archived?: boolean }>(["name", "kind", "archived"]);
export const UpdatePogRequest = z
  .strictObject({
    expected_revision: ExpectedRevision,
    name: text(200).optional(),
    kind: PogKind.optional(),
    archived: z.boolean().optional(),
  })
  .refine(pogChange.check, { error: pogChange.message });
export type UpdatePogRequest = z.infer<typeof UpdatePogRequest>;

// ---------------------------------------------------------------------------
// Displays (managers of the store; admins organization-wide)
// ---------------------------------------------------------------------------

export const AssignedPog = z.strictObject({
  pog_id: Uuid,
  pog_name: z.string(),
  pog_kind: PogKind.nullable(),
  pog_archived: z.boolean(),
  pog_version_id: Uuid,
  version_number: z.number().int().positive(),
  published_at: Rfc3339Utc.nullable(),
});
export type AssignedPog = z.infer<typeof AssignedPog>;

export const Display = z.strictObject({
  display_id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  name: z.string(),
  active: z.boolean(),
  revision: z.number().int().positive(),
  created_at: Rfc3339Utc,
  updated_at: Rfc3339Utc,
  /** Published version currently assigned; null means scans are blocked (POG_NOT_ASSIGNED). */
  active_pog: AssignedPog.nullable(),
  latest_scan_at: Rfc3339Utc.nullable(),
  /** The assigned version uses a product that has since been archived; assign a new version. */
  has_archived_products: z.boolean(),
});
export type Display = z.infer<typeof Display>;

export const DisplaySlot = z.strictObject({
  slot_id: Uuid,
  label: z.string(),
  product_id: Uuid,
  product_name: z.string(),
  product_short_name: z.string(),
  product_active: z.boolean(),
  target_quantity: z.number().int(),
  refill_threshold: z.number().int().nullable(),
  sort_order: z.number().int(),
});

export const DisplayDetail = z.strictObject({
  display: Display,
  store: z.strictObject({ store_id: Uuid, name: z.string(), store_number: z.string(), timezone: z.string(), active: z.boolean() }),
  /** Slots of the assigned version in sort order; empty when nothing is assigned. */
  slots: z.array(DisplaySlot),
});
export type DisplayDetail = z.infer<typeof DisplayDetail>;

export const CreateDisplayRequest = z.strictObject({
  name: text(200),
  active_pog_version_id: Uuid.nullable().optional(),
});
export type CreateDisplayRequest = z.infer<typeof CreateDisplayRequest>;

const displayChange = atLeastOne<{ name?: string; active?: boolean; active_pog_version_id?: string | null }>(["name", "active", "active_pog_version_id"]);
export const UpdateDisplayRequest = z
  .strictObject({
    expected_revision: ExpectedRevision,
    name: text(200).optional(),
    active: z.boolean().optional(),
    /** Published version to assign; null unassigns (new scans are then blocked). */
    active_pog_version_id: Uuid.nullable().optional(),
  })
  .refine(displayChange.check, { error: displayChange.message });
export type UpdateDisplayRequest = z.infer<typeof UpdateDisplayRequest>;

// ---------------------------------------------------------------------------
// List query (cursor pagination over created_at/id, oldest first; the cursor
// is opaque and issued by the server)
// ---------------------------------------------------------------------------

export const ListQuery = z.strictObject({
  status: ListStatus.default("active"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
  organization_id: Uuid.optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;
