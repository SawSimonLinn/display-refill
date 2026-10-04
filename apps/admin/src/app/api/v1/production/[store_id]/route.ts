import { ProductionAction, ProductionQuery } from "@display-refill/domain";
import { createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, parseIdempotencyKey, readJsonBody, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { uuidParam } from "@/server/api-handlers";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{store_id:string}>};
export async function GET(request:Request, context:Context) {
 const requestId=resolveRequestId(request.headers);
 const auth=await authenticateApi(request,requestId,{mutation:false}); if(!auth.ok)return auth.response;
 const {store_id}=await context.params;
 const id=uuidParam(store_id,"Store",requestId);if(!id.ok)return id.response;
 const query=ProductionQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!query.success)return jsonError("VALIDATION_FAILED","Invalid query.",requestId,{fieldErrors:fieldErrorsOf(query.error)});
 const result=await createServiceClient(auth.ctx.config).rpc("production_read",{p_actor:auth.ctx.user.id,p_store:store_id,p_view:query.data.view,p_check:query.data.check_id});
 return result.error?jsonFailure(fromDbError(result.error),requestId):jsonData(result.data,requestId);
}
export async function POST(request:Request, context:Context) {
 const requestId=resolveRequestId(request.headers);
 const auth=await authenticateApi(request,requestId,{mutation:true});if(!auth.ok)return auth.response;
 const {store_id}=await context.params;
 const id=uuidParam(store_id,"Store",requestId);if(!id.ok)return id.response;
 const body=await readJsonBody(request);if(!body.ok)return jsonError(body.code,body.message,requestId);
 const parsed=ProductionAction.safeParse(body.value);
 if(!parsed.success)return jsonError("VALIDATION_FAILED","Invalid worksheet input.",requestId,{fieldErrors:fieldErrorsOf(parsed.error)});
 const key=parseIdempotencyKey(request.headers);if(!key.ok)return jsonFailure(key,requestId);
 const result=await createServiceClient(auth.ctx.config).rpc("production_mutate",{p_actor:auth.ctx.user.id,p_store:store_id,p_body:parsed.data,p_key:key.value,p_request_id:requestId});
 return result.error?jsonFailure(fromDbError(result.error),requestId):jsonData(result.data,requestId);
}
