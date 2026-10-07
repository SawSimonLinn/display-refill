import { z } from "zod";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, parseIdempotencyKey, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ store_id: string }> };
const Input = z.discriminatedUnion("action", [
 z.strictObject({ action: z.literal("record"), product_id: z.uuid(), quantity: z.int().min(1).max(9999), reason: z.enum(["expired", "quality", "damaged", "other"]), note: z.string().max(300).default(""), business_date: z.iso.date().optional() }),
 z.strictObject({ action: z.literal("void"), entry_id: z.uuid() }),
 z.strictObject({ action: z.literal("edit"), entry_id: z.uuid(), quantity: z.int().min(1).max(9999), reason: z.enum(["expired", "quality", "damaged", "other"]), note: z.string().max(300).default("") })
]);
export async function POST(request: Request, context: Context) {
 const requestId = resolveRequestId(request.headers);
 const auth = await authenticateApi(request, requestId, { mutation: true }); if (!auth.ok) return auth.response;
 const { store_id } = await context.params;
 const id = uuidParam(store_id, "Store", requestId); if (!id.ok) return id.response;
 const body = await readJsonBody(request); if (!body.ok) return jsonError(body.code, body.message, requestId);
 const parsed = Input.safeParse(body.value);
 if (!parsed.success) return jsonError("VALIDATION_FAILED", "Choose a product, whole quantity and waste reason.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
 const key = parseIdempotencyKey(request.headers); if (!key.ok) return jsonFailure(key, requestId);
 const result = await createServiceClient(auth.ctx.config).rpc("production_waste_record", { p_actor: auth.ctx.user.id, p_store: store_id, p_body: parsed.data, p_key: key.value });
 return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
