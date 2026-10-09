import { z } from "zod";
import { Uuid } from "./primitives";
import { ProductionSection } from "./production";

/**
 * Self-service onboarding and display case types (Feature 16). Bodies are strict;
 * the database re-checks membership, roles and tenancy.
 */

export const OnboardingState = z.enum(["access_code", "removed", "store", "complete"]);
export type OnboardingState = z.infer<typeof OnboardingState>;

/** POST /onboarding/join. Spaces, dashes and case are ignored by the server. */
export const RedeemAccessCodeRequest = z.strictObject({ access_code: z.string().trim().min(4).max(64) });

/** POST /onboarding/store: name and timezone are required only when the number is new. */
export const OnboardingStoreRequest = z.strictObject({
  store_number: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

/** PATCH /stores/:id/settings (store managers). */
export const StoreSettingsRequest = z.strictObject({
  expected_revision: z.int().positive(),
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(64),
});

/** PUT /stores/:id/display-types. */
export const StoreDisplayTypesRequest = z.strictObject({
  display_type_ids: z.array(Uuid).min(1).max(50).refine((ids) => new Set(ids).size === ids.length, { error: "must be unique" }),
});

export const DisplayTypeFamily = z.enum(["Fruit", "Vegetables", "Salads", "Other"]);

/** POST /display-types (organization admins). */
export const DisplayTypeAction = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("save_type"),
    id: Uuid.optional(),
    code: ProductionSection.optional(),
    name: z.string().trim().min(1).max(80),
    family: DisplayTypeFamily,
    sort_order: z.int().min(0).max(999),
    active: z.boolean(),
    expected_revision: z.int().positive().optional(),
  })
    .refine((x) => (x.id ? x.expected_revision !== undefined : x.code !== undefined), { error: "code is required for a new type; expected_revision when editing", path: ["code"] }),
  z.strictObject({
    action: z.literal("save_item"),
    display_type_id: Uuid,
    id: Uuid.optional(),
    product_id: Uuid,
    par: z.int().min(0).max(9999),
    category: z.string().trim().max(100),
    product_type: z.string().trim().max(100),
    sort_order: z.int().min(0).max(999),
    active: z.boolean(),
    expected_revision: z.int().positive().optional(),
  }).refine((x) => !x.id || x.expected_revision !== undefined, { error: "Revision is required when editing", path: ["expected_revision"] }),
  z.strictObject({
    action: z.literal("move_item"),
    display_type_id: Uuid,
    id: Uuid,
    direction: z.enum(["up", "down"]),
    expected_revision: z.int().positive(),
  }),
]);
export type DisplayTypeAction = z.infer<typeof DisplayTypeAction>;

/** POST /access-code (organization admins). */
export const AccessCodeAction = z.strictObject({ action: z.enum(["rotate", "disable", "enable"]) });
