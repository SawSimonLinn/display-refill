import { z } from "zod";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, parseIdempotencyKey, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ store_id: string }> };
const Input = z.strictObject({ product_id: z.uuid(), expected_revision: z.string().regex(/^[a-f0-9]{64}$/), quantity: z.int().min(1).max(9999).optional(), done: z.boolean().default(false) })
 .refine(x => x.done ? x.quantity === undefined : x.quantity !== undefined, { message: "Choose a quantity or Done.", path: ["quantity"] });
export async function GET(request: Request, context: Context) {
 const requestId = resolveRequestId(request.headers);
 const auth = await authenticateApi(request, requestId, { mutation: false }); if (!auth.ok) return auth.response;
 const { store_id } = await context.params;
 const id = uuidParam(store_id, "Store", requestId); if (!id.ok) return id.response;
 const result = await createServiceClient(auth.ctx.config).rpc("production_prep_read", { p_actor: auth.ctx.user.id, p_store: store_id });
 return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
export async function POST(request: Request, context: Context) {
 const requestId = resolveRequestId(request.headers);
 const auth = await authenticateApi(request, requestId, { mutation: true }); if (!auth.ok) return auth.response;
 const { store_id } = await context.params;
 const id = uuidParam(store_id, "Store", requestId); if (!id.ok) return id.response;
 const body = await readJsonBody(request); if (!body.ok) return jsonError(body.code, body.message, requestId);
 const parsed = Input.safeParse(body.value);
 if (!parsed.success) return jsonError("VALIDATION_FAILED", "Enter the number of finished containers, or choose Done.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
 const key = parseIdempotencyKey(request.headers); if (!key.ok) return jsonFailure(key, requestId);
 const result = await createServiceClient(auth.ctx.config).rpc("production_prep_record", { p_actor: auth.ctx.user.id, p_store: store_id, p_product: parsed.data.product_id, p_revision: parsed.data.expected_revision, p_quantity: parsed.data.quantity ?? 0, p_done: parsed.data.done, p_key: key.value });
 return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
