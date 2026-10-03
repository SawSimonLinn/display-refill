import type { InviteMemberRequest, Member, MemberChangeResult, OrgRole, StoreRole, UpdateMemberRequest } from "@display-refill/domain";
import { isAuthApiError } from "@supabase/supabase-js";
import type { Json } from "./database.types";
import type { Logger } from "./logger";
import { fail, fromDbError, ok, type ServiceResult } from "./result";
import type { DbClient } from "./supabase";

/**
 * Admin-only membership management. Every function takes the actor verified
 * by the API and the organization it resolved; the database functions
 * re-check that the actor is an active admin of that organization.
 */

const iso = (value: string) => new Date(value).toISOString();

export async function listMembers(service: DbClient, actorId: string, organizationId: string): Promise<ServiceResult<Member[]>> {
  const { data, error } = await service.rpc("list_organization_members", { p_actor: actorId, p_org: organizationId });
  if (error) return fromDbError(error);
  return ok(
    data.map((m) => ({
      user_id: m.user_id,
      email: m.email,
      display_name: m.display_name,
      org_role: m.org_role as OrgRole,
      active: m.active,
      revision: m.revision,
      invited_at: iso(m.invited_at),
      last_sign_in_at: (m.last_sign_in_at as string | null) ? iso(m.last_sign_in_at) : null,
      stores: (m.stores as Array<{ store_id: string; role: StoreRole; active: boolean }>) ?? [],
    })),
  );
}

export interface InviteContext {
  service: DbClient;
  actorId: string;
  organizationId: string;
  requestId: string;
  /** Allowlisted confirm page, built from APP_ORIGIN (never from the request). */
  redirectTo: string;
  logger: Logger;
}

export async function inviteMember(ctx: InviteContext, input: InviteMemberRequest): Promise<ServiceResult<MemberChangeResult>> {
  const { service, actorId, organizationId, requestId, logger } = ctx;

  // Validate store IDs before creating an Auth identity (and sending email).
  // apply_membership_invite re-validates inside its transaction.
  if (input.stores.length > 0) {
    const { data, error } = await service
      .from("stores")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .in("id", input.stores.map((s) => s.store_id));
    if (error) return fromDbError(error);
    if (data.length !== input.stores.length) {
      return fail("VALIDATION_FAILED", "The request contains invalid values.", { fieldErrors: { stores: ["store not found or archived"] } });
    }
  }

  const invited = await service.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: ctx.redirectTo,
    data: input.display_name ? { display_name: input.display_name } : undefined,
  });
  if (invited.error || !invited.data.user) {
    const err = invited.error;
    if (isAuthApiError(err) && (err.code === "email_exists" || err.code === "user_already_exists")) {
      // Invitations only create new identities (decision D33).
      return fail("CONFLICT", "An account with this email already exists.", { fieldErrors: { email: ["already registered"] } });
    }
    if (isAuthApiError(err) && (err.code === "over_email_send_rate_limit" || err.status === 429)) {
      return fail("RATE_LIMITED", "Too many emails sent. Try again later.", { retryAfterSeconds: 60 });
    }
    if (isAuthApiError(err) && (err.code === "email_address_invalid" || err.code === "validation_failed")) {
      return fail("VALIDATION_FAILED", "The email address was rejected.", { fieldErrors: { email: ["was rejected"] } });
    }
    logger.error("invite: auth admin invite failed", { request_id: requestId, status: isAuthApiError(err) ? err.status : undefined, auth_code: isAuthApiError(err) ? err.code : undefined });
    return fail("DEPENDENCY_UNAVAILABLE", "Could not send the invitation. Try again shortly.");
  }

  const userId = invited.data.user.id;
  const applied = await service.rpc("apply_membership_invite", {
    p_actor: actorId,
    p_org: organizationId,
    p_user: userId,
    p_org_role: input.org_role,
    p_stores: input.stores as unknown as Json,
    p_request_id: requestId,
  });
  if (applied.error) {
    // Compensate: the identity was just created and holds no membership.
    const removed = await service.auth.admin.deleteUser(userId);
    logger.warn("invite: membership write failed; invited identity removed", {
      request_id: requestId,
      user_id: userId,
      db_error: applied.error.message,
      removed: !removed.error,
    });
    return fromDbError(applied.error);
  }
  logger.info("invite: member invited", { request_id: requestId, user_id: userId, organization_id: organizationId, actor_id: actorId });
  return ok({ user_id: userId, revision: applied.data });
}

export async function updateMember(
  service: DbClient,
  actorId: string,
  organizationId: string,
  userId: string,
  input: UpdateMemberRequest,
  requestId: string,
): Promise<ServiceResult<MemberChangeResult>> {
  const { data, error } = await service.rpc("update_membership", {
    p_actor: actorId,
    p_org: organizationId,
    p_user: userId,
    p_expected_revision: input.expected_revision,
    p_org_role: input.org_role,
    p_active: input.active,
    p_stores: input.stores as unknown as Json | undefined,
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return ok({ user_id: userId, revision: data });
}
