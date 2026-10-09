import { StoreSettingsRequest } from "@display-refill/domain";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ store_id: string }> };

/** Store managers rename their store or change its timezone. Number and archiving stay admin-only. */
export async function PATCH(request: Request, context: Context) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const { store_id } = await context.params;
  const id = uuidParam(store_id, "Store", requestId);
  if (!id.ok) return id.response;
  const body = await readJsonBody(request, 4096);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = StoreSettingsRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const result = await createServiceClient(auth.ctx.config).rpc("store_settings_update", {
    p_actor: auth.ctx.user.id, p_store: store_id, p_expected_revision: parsed.data.expected_revision,
    p_name: parsed.data.name, p_timezone: parsed.data.timezone, p_request_id: requestId,
  });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
