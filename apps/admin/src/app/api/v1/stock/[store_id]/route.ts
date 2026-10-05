import { z } from "zod";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, parseIdempotencyKey, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ store_id: string }> };
const Input = z.strictObject({product_id:z.uuid(),expected_revision:z.string().regex(/^[a-f0-9]{64}$/),counts:z.array(z.strictObject({section:z.enum(["fruit_mobile","salad_mobile","fruit_case","veggie_case"]),have:z.int().min(0).max(9999),backup:z.int().min(0).max(9999).optional()})).min(1).max(4)});
export async function POST(request: Request, context: Context) {
 const requestId = resolveRequestId(request.headers);
 const auth = await authenticateApi(request, requestId, { mutation: true }); if (!auth.ok) return auth.response;
 const { store_id } = await context.params;
 const id = uuidParam(store_id, "Store", requestId); if (!id.ok) return id.response;
 const body = await readJsonBody(request); if (!body.ok) return jsonError(body.code, body.message, requestId);
 const parsed = Input.safeParse(body.value);
 if (!parsed.success) return jsonError("VALIDATION_FAILED", "Count all locations for this product.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
 const key = parseIdempotencyKey(request.headers); if (!key.ok) return jsonFailure(key, requestId);
 const result = await createServiceClient(auth.ctx.config).rpc("production_stock_record", {p_actor:auth.ctx.user.id,p_store:store_id,p_product:parsed.data.product_id,p_revision:parsed.data.expected_revision,p_counts:parsed.data.counts,p_key:key.value});
 return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
