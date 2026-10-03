import type { Me, MeOrganization, MeStore, OrgRole, StoreRole } from "@display-refill/domain";
import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { AdminServerConfig } from "./config";
import { fail, ok, type ServiceResult } from "./result";
import { createPublicClient, type DbClient } from "./supabase";

export interface VerifiedUser {
  id: string;
  email: string | null;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Verifies an access token with Supabase Auth (`GET /auth/v1/user`). This
 * checks the signature and expiry and that the session still exists, so a
 * token from a signed-out session is rejected even before it expires. Local
 * JWT verification (getClaims) would not detect sign-out; see decision D30.
 */
export async function verifyAccessToken(config: AdminServerConfig, token: string): Promise<ServiceResult<VerifiedUser>> {
  if (token.length > 8192 || !JWT_SHAPE.test(token)) return fail("UNAUTHENTICATED", "Sign in again.");
  const { data, error } = await createPublicClient(config).auth.getUser(token);
  if (data.user) return ok({ id: data.user.id, email: data.user.email ?? null });
  return authFailure(error);
}

/** 401 for rejected credentials; 503 when Supabase Auth cannot be reached. */
export function authFailure(error: unknown) {
  if (isAuthRetryableFetchError(error) || (isAuthApiError(error) && error.status >= 500)) {
    return fail("DEPENDENCY_UNAVAILABLE", "Sign-in service is unavailable. Try again shortly.");
  }
  return fail("UNAUTHENTICATED", "Sign in again.");
}

/** `Authorization: Bearer <token>`; undefined when absent, null when malformed. */
export function bearerToken(headers: Headers): string | null | undefined {
  const value = headers.get("authorization");
  if (value === null) return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
  return match ? match[1]! : null;
}

/**
 * Loads the caller's identity, organizations and accessible stores through a
 * caller-scoped client, so RLS decides what is visible. Only active
 * memberships of active organizations count; user metadata is never read.
 */
export async function loadMe(caller: DbClient, user: VerifiedUser): Promise<ServiceResult<Me>> {
  const [profile, orgMemberships, storeMemberships, stores] = await Promise.all([
    caller.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
    caller.from("organization_memberships").select("organization_id, role, active, organizations(name, active)").eq("user_id", user.id),
    caller.from("store_memberships").select("store_id, role, active").eq("user_id", user.id),
    caller.from("stores").select("id, organization_id, name, store_number, timezone, active"),
  ]);
  const failed = [profile, orgMemberships, storeMemberships, stores].find((r) => r.error);
  if (failed?.error) {
    return fail("DEPENDENCY_UNAVAILABLE", "The database is unavailable. Try again shortly.");
  }

  const organizations: MeOrganization[] = (orgMemberships.data ?? [])
    .filter((m) => m.active && m.organizations?.active)
    .map((m) => ({ organization_id: m.organization_id, name: m.organizations!.name, role: m.role as OrgRole }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const adminOrgs = new Set(organizations.filter((o) => o.role === "admin").map((o) => o.organization_id));
  const memberOrgs = new Set(organizations.map((o) => o.organization_id));
  const storeRole = new Map(
    (storeMemberships.data ?? []).filter((m) => m.active).map((m) => [m.store_id, m.role as StoreRole]),
  );

  const meStores: MeStore[] = [];
  for (const s of stores.data ?? []) {
    if (!s.active || !memberOrgs.has(s.organization_id)) continue;
    const role = adminOrgs.has(s.organization_id) ? "admin" : storeRole.get(s.id);
    if (!role) continue; // RLS already filters; this keeps the projection strict
    meStores.push({ store_id: s.id, organization_id: s.organization_id, name: s.name, store_number: s.store_number, timezone: s.timezone, role });
  }
  meStores.sort((a, b) => a.name.localeCompare(b.name) || a.store_number.localeCompare(b.store_number));

  return ok({
    user_id: user.id,
    email: user.email,
    display_name: profile.data?.display_name ?? "",
    organizations,
    stores: meStores,
    capabilities: {
      dashboard: adminOrgs.size > 0 || meStores.some((s) => s.role === "manager"),
      admin_organization_ids: [...adminOrgs].sort(),
    },
  });
}

/** True when the caller holds at least one active organization membership. */
export const hasActiveMembership = (me: Me) => me.organizations.length > 0;

/**
 * The organization an admin-only request acts on. An explicit
 * organization_id must be one the caller administers; without one, the
 * caller's single administered organization is used.
 */
export function resolveAdminOrganization(me: Me, requested: string | undefined, forbidden = "Only organization admins can manage members."): ServiceResult<string> {
  const admin = me.capabilities.admin_organization_ids;
  if (requested) {
    if (admin.includes(requested)) return ok(requested);
    if (me.organizations.some((o) => o.organization_id === requested)) {
      return fail("FORBIDDEN", forbidden);
    }
    return fail("NOT_FOUND", "Organization not found.");
  }
  if (admin.length === 1) return ok(admin[0]!);
  if (admin.length === 0) return fail("FORBIDDEN", forbidden);
  return fail("VALIDATION_FAILED", "Choose an organization.", { fieldErrors: { organization_id: ["is required when you administer several organizations"] } });
}

/**
 * The organization a catalog read acts on: an explicit organization_id must
 * be one the caller belongs to; without one, the caller's only organization.
 */
export function resolveMemberOrganization(me: Me, requested: string | undefined): ServiceResult<string> {
  if (requested) {
    return me.organizations.some((o) => o.organization_id === requested) ? ok(requested) : fail("NOT_FOUND", "Organization not found.");
  }
  if (me.organizations.length === 1) return ok(me.organizations[0]!.organization_id);
  return fail("VALIDATION_FAILED", "Choose an organization.", { fieldErrors: { organization_id: ["is required when you belong to several organizations"] } });
}
