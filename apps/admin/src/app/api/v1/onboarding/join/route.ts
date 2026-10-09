import { RedeemAccessCodeRequest } from "@display-refill/domain";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { clientKey, limits } from "@/server/auth-actions";

export const dynamic = "force-dynamic";

/**
 * Redeem the organization access code. Joins as `member` only. Limited per account and per
 * client; a wrong, disabled or rotated code gets the same answer. Repeating it is harmless.
 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true, allowWithoutMembership: true });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = RedeemAccessCodeRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "Enter the access code.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  for (const limited of [await limits.accessCodePerUser.hit(auth.ctx.user.id), await limits.accessCodePerClient.hit(clientKey(request.headers))]) {
    if (!limited.allowed) {
      return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", requestId, { headers: { "retry-after": String(limited.retryAfterSeconds) } });
    }
  }
  const result = await createServiceClient(auth.ctx.config).rpc("redeem_access_code", { p_actor: auth.ctx.user.id, p_code: parsed.data.access_code, p_request_id: requestId });
  if (result.error) {
    auth.ctx.logger.info("onboarding: access code refused", { request_id: requestId, actor_id: auth.ctx.user.id, reason: result.error.message });
    return jsonFailure(fromDbError(result.error), requestId);
  }
  return jsonData(result.data, requestId);
}
