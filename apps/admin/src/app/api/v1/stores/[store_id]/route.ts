import { UpdateStoreRequest } from "@display-refill/domain";
import { updateStore } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin renames, renumbers, changes the time zone of, archives (`active:
 * false`) or restores a store. The store's organization comes from the stored
 * row. Requires expected_revision (409 when stale) and Idempotency-Key.
 */
export async function PATCH(request: Request, route: RouteContext<"/api/v1/stores/[store_id]">) {
  const { store_id: storeId } = await route.params;
  return handleMutation(request, {
    schema: UpdateStoreRequest,
    routeScope: `PATCH /stores/${storeId}`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(storeId, "Store", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins can change stores.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => updateStore(service, ctx.user.id, storeId, body, requestId),
    resourceId: (store) => store.store_id,
  });
}
