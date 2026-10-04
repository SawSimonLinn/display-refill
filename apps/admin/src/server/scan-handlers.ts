import { z } from "zod";
import { manualWorkflow, scanAnalysisAction } from "@display-refill/server";
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

export async function manualMutation(request: Request, scanId?: string) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const schema = scanId ? ConfirmScanRequest : z.strictObject({
    display_id: z.uuid(), source: z.literal("manual"), expected_pog_version_id: z.uuid().optional(),
  });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  if (scanId) {
    const id = uuidParam(scanId, "Scan", requestId);
    if (!id.ok) return id.response;
  }
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok) return jsonFailure(key, requestId);
  const input = parsed.data;
  const result = await manualWorkflow(createServiceClient(auth.ctx.config), auth.ctx.user.id,
    scanId ? "complete" : "create", scanId ?? ("display_id" in input ? input.display_id : ""),
    "expected_revision" in input ? input.expected_revision : null,
    "expected_pog_version_id" in input ? input.expected_pog_version_id ?? null : null, key.value, requestId);
  if (!result.ok) return jsonFailure(result, requestId);
  const response = jsonData(result.value.detail, requestId, { status: scanId ? 200 : 201 });
  if (result.value.replayed) response.headers.set("idempotent-replayed", "true");
  return response;
}

/** POST /scans/:id/retry and /manual-takeover: strict {expected_revision}, Idempotency-Key. */
export async function analysisAction(request: Request, scanId: string, action: "retry" | "takeover") {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = uuidParam(scanId, "Scan", requestId);
  if (!id.ok) return id.response;
  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = ConfirmScanRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok) return jsonFailure(key, requestId);
  const result = await scanAnalysisAction(createServiceClient(auth.ctx.config), auth.ctx.user.id, action, scanId, parsed.data.expected_revision, key.value, requestId);
  if (!result.ok) return jsonFailure(result, requestId);
  const response = jsonData(result.value.detail, requestId);
  if (result.value.replayed) response.headers.set("idempotent-replayed", "true");
  return response;
}
