import { StoreDisplayTypesRequest } from "@display-refill/domain";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ store_id: string }> };

/**
 * Store managers choose which display case types the store has. The full list replaces the
 * previous selection; unchosen types keep their history. Returns the store's PAR configuration.
 */
export async function PUT(request: Request, context: Context) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const { store_id } = await context.params;
  const id = uuidParam(store_id, "Store", requestId);
  if (!id.ok) return id.response;
  const body = await readJsonBody(request, 8192);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = StoreDisplayTypesRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "Choose at least one display case type.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const result = await createServiceClient(auth.ctx.config).rpc("store_display_types_set", {
    p_actor: auth.ctx.user.id, p_store: store_id, p_type_ids: parsed.data.display_type_ids, p_request_id: requestId,
  });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
