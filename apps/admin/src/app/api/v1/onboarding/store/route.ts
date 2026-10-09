import { OnboardingStoreRequest } from "@display-refill/domain";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";

export const dynamic = "force-dynamic";

/**
 * Create or join a store by number in the caller's organization. A new number needs name
 * and timezone and makes the caller its manager; an existing store is joined as employee.
 * Repeating the call returns the same store and role.
 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = OnboardingStoreRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const { store_number, name, timezone } = parsed.data;
  const result = await createServiceClient(auth.ctx.config).rpc("onboarding_store", {
    p_actor: auth.ctx.user.id, p_store_number: store_number, p_name: name, p_timezone: timezone, p_request_id: requestId,
  });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
