import { createServiceClient, fromDbError, jsonData, jsonFailure, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";

export const dynamic = "force-dynamic";

/**
 * Onboarding state of the signed-in account (Feature 16): `access_code` (new account),
 * `removed` (revoked), `store` (member without a store) or `complete`. Works without a membership.
 */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: false, allowWithoutMembership: true });
  if (!auth.ok) return auth.response;
  const result = await createServiceClient(auth.ctx.config).rpc("onboarding_read", { p_actor: auth.ctx.user.id });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
