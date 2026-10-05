import { z } from "zod";
import { createServiceClient, fromDbError, jsonData, jsonError, jsonFailure, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ store_id: string }> };
const Query = z.strictObject({ day: z.iso.date().optional(), period: z.enum(["day", "week", "month"]).default("day") });
export async function GET(request: Request, context: Context) {
 const requestId = resolveRequestId(request.headers);
 const auth = await authenticateApi(request, requestId, { mutation: false }); if (!auth.ok) return auth.response;
 const { store_id } = await context.params;
 const id = uuidParam(store_id, "Store", requestId); if (!id.ok) return id.response;
 const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if (!parsed.success) return jsonError("VALIDATION_FAILED", "Choose a valid date and period.", requestId);
 const result = await createServiceClient(auth.ctx.config).rpc("production_operations_read", { p_actor: auth.ctx.user.id, p_store: store_id, p_day: parsed.data.day, p_period: parsed.data.period });
 return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
