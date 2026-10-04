import "server-only";
import { z } from "zod";
import { CreatePhoto, FinalizePhoto, createCallerClient, createServiceClient, finalizeScanPhoto, jsonData, jsonError, jsonFailure, parseIdempotencyKey, photoResponse, photoTransaction, readJsonBody, resolveRequestId, scanImageAccess, uploadScanPhoto } from "@display-refill/server";
import { authenticateApi } from "./api-auth";
export async function photoHandler(request: Request, action: "create" | "upload" | "renew" | "finalize" | "access", id?: string) {
  const rid = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, rid, { mutation: action !== "access" });
  if (!auth.ok) return auth.response;
  if (id && !z.uuid().safeParse(id).success) return jsonError("NOT_FOUND", "Scan not found.", rid);
  const service = createServiceClient(auth.ctx.config), actor = auth.ctx.user.id;
  if (action === "access") {
    // Same caller-scoped read as history and the record; see scanImageAccess.
    const result = await scanImageAccess(createCallerClient(auth.ctx.config, auth.ctx.accessToken), service, id!);
    return result.ok ? jsonData(result.value, rid) : jsonFailure(result, rid);
  }
  if (action === "upload") {
    const result = await uploadScanPhoto(service, actor, id!, request);
    return result.ok ? jsonData(result.value, rid) : jsonFailure(result, rid);
  }
  if (action === "renew") {
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.code, body.message, rid);
    if (!z.strictObject({}).safeParse(body.value).success) return jsonError("VALIDATION_FAILED", "Expected empty object.", rid);
    const result = await photoTransaction(service, actor, "renew", id!, {});
    return result.ok ? jsonData(photoResponse(result.value), rid) : jsonFailure(result, rid);
  }
  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, rid);
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok) return jsonFailure(key, rid);
  if (action === "create") {
    const parsed = CreatePhoto.safeParse(body.value);
    if (!parsed.success) return jsonError("VALIDATION_FAILED", "Invalid photo scan request.", rid);
    const result = await photoTransaction(service, actor, "create", parsed.data.display_id, { expected_pog_version_id: parsed.data.expected_pog_version_id }, key.value, undefined, rid);
    if (!result.ok) return jsonFailure(result, rid);
    return jsonData(photoResponse(result.value), rid, { status: 201, headers: result.value.replayed ? { "idempotent-replayed": "true" } : {} });
  }
  const parsed = FinalizePhoto.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "Invalid crop or revision.", rid);
  const result = await finalizeScanPhoto(service, actor, id!, parsed.data, key.value, rid);
  if (!result.ok) return jsonFailure(result, rid);
  return jsonData(photoResponse(result.value), rid, { headers: result.value.replayed ? { "idempotent-replayed": "true" } : {} });
}
