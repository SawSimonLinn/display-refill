import "server-only";
import { ConfirmScanRequest, SaveCountsRequest } from "@display-refill/domain";
import { createServiceClient, fieldErrorsOf, jsonData, jsonError, jsonFailure, mutateScan, parseIdempotencyKey, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "./api-auth";
import { uuidParam } from "./api-handlers";
/** Idempotency is owned by the scan transaction, including the response snapshot. */
export async function scanMutation(request: Request, scanId: string, action: "counts" | "confirm") {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok)
    return auth.response;
  const id = uuidParam(scanId, "Scan", requestId);
  if (!id.ok)
    return id.response;
  const body = await readJsonBody(request);
  if (!body.ok)
    return jsonError(body.code, body.message, requestId);
  const parsed = (action === "counts" ? SaveCountsRequest : ConfirmScanRequest).safeParse(body.value);
  if (!parsed.success)
    return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok)
    return jsonFailure(key, requestId);
  const result = await mutateScan(createServiceClient(auth.ctx.config), auth.ctx.user.id, scanId, action, parsed.data, key.value, requestId);
  if (!result.ok)
    return jsonFailure(result, requestId);
  const response = jsonData(result.value.detail, requestId);
  if (result.value.replayed)
    response.headers.set("idempotent-replayed", "true");
  return response;
}
