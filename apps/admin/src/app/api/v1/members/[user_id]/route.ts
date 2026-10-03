import { UpdateMemberRequest, Uuid } from "@display-refill/domain";
import {
  createServiceClient,
  fieldErrorsOf,
  jsonError,
  jsonFailure,
  parseIdempotencyKey,
  readJsonBody,
  resolveAdminOrganization,
  resolveRequestId,
  updateMember,
  withIdempotency,
} from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { replay } from "@/server/api-respond";

export const dynamic = "force-dynamic";

/**
 * Admin changes a member's organization role, store assignments or revokes
 * access. Requires expected_revision and Idempotency-Key. Removing the last
 * active admin returns 409.
 */
export async function PATCH(request: Request, ctxRoute: RouteContext<"/api/v1/members/[user_id]">) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { user_id: userId } = await ctxRoute.params;
  if (!Uuid.safeParse(userId).success) return jsonError("NOT_FOUND", "Member not found.", requestId);

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = UpdateMemberRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });

  const org = resolveAdminOrganization(ctx.me, parsed.data.organization_id);
  if (!org.ok) return jsonFailure(org, requestId);
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok) return jsonFailure(key, requestId);

  const service = createServiceClient(ctx.config);
  const outcome = await withIdempotency(
    service,
    { actorId: ctx.user.id, routeScope: `PATCH /members/${userId}`, key: key.value, body: { ...parsed.data, organization_id: org.value } },
    async () => {
      const updated = await updateMember(service, ctx.user.id, org.value, userId, parsed.data, requestId);
      if (!updated.ok) {
        const response = jsonFailure(updated, requestId);
        return { status: response.status, body: await response.json() };
      }
      ctx.logger.info("members: membership updated", { request_id: requestId, user_id: userId, organization_id: org.value, actor_id: ctx.user.id });
      return { status: 200, body: { data: updated.value, request_id: requestId }, resourceId: userId };
    },
  );
  if (!outcome.ok) return jsonFailure(outcome, requestId);
  return replay(outcome.value, requestId);
}
