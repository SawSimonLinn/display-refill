import { CreateStoreRequest } from "@display-refill/domain";
import { createStore, listStores, resolveAdminOrganization } from "@display-refill/server";
import { callerClient, handleMutation, handleRead } from "@/server/api-handlers";
import { jsonFailureOutcome } from "@/server/api-respond";

export const dynamic = "force-dynamic";

/**
 * Accessible stores, oldest first. `?status=active|archived|all` (archived
 * stores only for their admins and managers), `?organization_id=`, cursor.
 */
export async function GET(request: Request) {
  return handleRead(request, (ctx, query) => listStores(callerClient(ctx), ctx.me, query));
}

/** Admin creates a store in their organization. Requires Idempotency-Key. */
export async function POST(request: Request) {
  return handleMutation(request, {
    schema: CreateStoreRequest,
    routeScope: "POST /stores",
    successStatus: 201,
    prepare: (ctx, body, requestId) => jsonFailureOutcome(resolveAdminOrganization(ctx.me, body.organization_id, "Only organization admins can create stores."), requestId),
    execute: (service, ctx, body, org, requestId) => createStore(service, ctx.user.id, org, body, requestId),
    resourceId: (store) => store.store_id,
    hashExtra: (org) => ({ organization_id: org }),
  });
}
