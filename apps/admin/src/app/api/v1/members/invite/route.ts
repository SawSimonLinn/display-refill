import { InviteMemberRequest } from "@display-refill/domain";
import {
  createServiceClient,
  fieldErrorsOf,
  inviteMember,
  jsonError,
  jsonFailure,
  parseIdempotencyKey,
  readJsonBody,
  resolveAdminOrganization,
  resolveRequestId,
  withIdempotency,
} from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { confirmUrl, limits } from "@/server/auth-actions";
import { replay } from "@/server/api-respond";

export const dynamic = "force-dynamic";

/**
 * Admin invites a new user: creates the Supabase Auth identity (invite email
 * with an allowlisted link), then the organization and store memberships in
 * one transaction. Requires Idempotency-Key.
 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = InviteMemberRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });

  const org = resolveAdminOrganization(ctx.me, parsed.data.organization_id);
  if (!org.ok) return jsonFailure(org, requestId);
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok) return jsonFailure(key, requestId);
  const limited = limits.invitesPerActor.hit(ctx.user.id);
  if (!limited.allowed) {
    return jsonError("RATE_LIMITED", "Too many invitations. Try again later.", requestId, { headers: { "retry-after": String(limited.retryAfterSeconds) } });
  }

  const service = createServiceClient(ctx.config);
  const outcome = await withIdempotency(
    service,
    { actorId: ctx.user.id, routeScope: "POST /members/invite", key: key.value, body: { ...parsed.data, organization_id: org.value } },
    async () => {
      const invited = await inviteMember(
        { service, actorId: ctx.user.id, organizationId: org.value, requestId, redirectTo: confirmUrl(ctx.config), logger: ctx.logger },
        parsed.data,
      );
      if (!invited.ok) {
        const response = jsonFailure(invited, requestId);
        return { status: response.status, body: await response.json() };
      }
      return { status: 201, body: { data: invited.value, request_id: requestId }, resourceId: invited.value.user_id };
    },
  );
  if (!outcome.ok) return jsonFailure(outcome, requestId);
  return replay(outcome.value, requestId);
}
