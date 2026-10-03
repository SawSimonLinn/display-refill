import { z } from "zod";
import { Rfc3339Utc, Uuid } from "./primitives";

/**
 * Identity and membership contracts (feature 03). Roles come only from
 * database membership rows; nothing here is read from user metadata.
 */
export const OrgRole = z.enum(["member", "admin"]);
export type OrgRole = z.infer<typeof OrgRole>;

export const StoreRole = z.enum(["employee", "manager"]);
export type StoreRole = z.infer<typeof StoreRole>;

/** Effective role in an accessible store: org admins act as "admin" everywhere in their organization. */
export const StoreAccessRole = z.enum(["employee", "manager", "admin"]);
export type StoreAccessRole = z.infer<typeof StoreAccessRole>;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt input limit used by Supabase Auth

export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email({ error: "must be an email address" }));

export const NewPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `must be at least ${PASSWORD_MIN_LENGTH} characters` })
  .max(PASSWORD_MAX_LENGTH, { error: `must be at most ${PASSWORD_MAX_LENGTH} characters` });

// ---------------------------------------------------------------------------
// GET /api/v1/me
// ---------------------------------------------------------------------------

export const MeOrganization = z.strictObject({
  organization_id: Uuid,
  name: z.string(),
  role: OrgRole,
});

export const MeStore = z.strictObject({
  store_id: Uuid,
  organization_id: Uuid,
  name: z.string(),
  store_number: z.string(),
  timezone: z.string(),
  role: StoreAccessRole,
});

export const Me = z.strictObject({
  user_id: Uuid,
  email: z.string().nullable(),
  display_name: z.string(),
  organizations: z.array(MeOrganization),
  stores: z.array(MeStore),
  capabilities: z.strictObject({
    /** Admin in any organization, or manager of any store: may open the web dashboard. */
    dashboard: z.boolean(),
    /** Organization IDs the user administers (members, catalog, POGs). */
    admin_organization_ids: z.array(Uuid),
  }),
});
export type Me = z.infer<typeof Me>;
export type MeStore = z.infer<typeof MeStore>;
export type MeOrganization = z.infer<typeof MeOrganization>;

// ---------------------------------------------------------------------------
// Members (admin only)
// ---------------------------------------------------------------------------

export const StoreAssignment = z.strictObject({ store_id: Uuid, role: StoreRole });
export type StoreAssignment = z.infer<typeof StoreAssignment>;

const storeAssignments = z
  .array(StoreAssignment)
  .max(200)
  .refine((items) => new Set(items.map((i) => i.store_id)).size === items.length, { error: "store_id values must be unique" });

export const Member = z.strictObject({
  user_id: Uuid,
  email: z.string().nullable(),
  display_name: z.string(),
  org_role: OrgRole,
  active: z.boolean(),
  revision: z.number().int().positive(),
  invited_at: Rfc3339Utc,
  last_sign_in_at: Rfc3339Utc.nullable(),
  stores: z.array(z.strictObject({ store_id: Uuid, role: StoreRole, active: z.boolean() })),
});
export type Member = z.infer<typeof Member>;

export const InviteMemberRequest = z.strictObject({
  organization_id: Uuid.optional(),
  email: Email,
  display_name: z.string().trim().max(200).optional(),
  org_role: OrgRole,
  stores: storeAssignments,
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequest>;

export const UpdateMemberRequest = z
  .strictObject({
    organization_id: Uuid.optional(),
    expected_revision: z.number().int().positive(),
    org_role: OrgRole.optional(),
    active: z.boolean().optional(),
    /** Complete set of active store assignments; omitted means unchanged. */
    stores: storeAssignments.optional(),
  })
  .refine((b) => b.org_role !== undefined || b.active !== undefined || b.stores !== undefined, {
    error: "change at least one of org_role, active or stores",
  });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const MemberChangeResult = z.strictObject({ user_id: Uuid, revision: z.number().int().positive() });
export type MemberChangeResult = z.infer<typeof MemberChangeResult>;

export const PasswordResetRequest = z.strictObject({ email: Email });

// ---------------------------------------------------------------------------
// Redirect validation
// ---------------------------------------------------------------------------

/** Email link types the web confirm page accepts. */
export const AuthLinkType = z.enum(["invite", "recovery"]);
export type AuthLinkType = z.infer<typeof AuthLinkType>;

/**
 * In-app destinations a `next` parameter may name after sign-in or an email
 * link. Anything else (absolute URLs, protocol-relative `//host`, backslash
 * tricks, encoded slashes, unknown paths) falls back to `fallback`.
 */
const NEXT_PATH_PREFIXES = ["/stores", "/displays", "/products", "/pogs", "/scans", "/members", "/account"] as const;

export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return fallback;
  // Only a single leading slash followed by safe path characters. Rejects
  // "//evil", "/\\evil", "https:", control characters and percent-encoding.
  if (!/^\/[A-Za-z0-9\-._~/]*(\?[A-Za-z0-9\-._~=&]*)?$/.test(raw) || raw.startsWith("//") || raw.includes("/..") || raw.includes("/./")) {
    return fallback;
  }
  const path = raw.split("?")[0]!;
  if (path === "/") return raw;
  return NEXT_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ? raw : fallback;
}
