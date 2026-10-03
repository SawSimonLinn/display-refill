import { CreateDisplayRequest } from "@display-refill/domain";
import { createDisplay, listDisplays } from "@display-refill/server";
import { callerClient, handleMutation, handleRead, requireSomeManager, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Displays of an accessible store with the assigned published POG and the
 * latest scan time. Archived displays (`?status=archived|all`) only for the
 * store's managers and organization admins.
 */
export async function GET(request: Request, route: RouteContext<"/api/v1/stores/[store_id]/displays">) {
  const { store_id: storeId } = await route.params;
  return handleRead(request, async (ctx, query, requestId) => {
    const id = uuidParam(storeId, "Store", requestId);
    return id.ok ? listDisplays(callerClient(ctx), ctx.me, storeId, query) : id;
  });
}

/**
 * A manager of this store (or an organization admin) adds a display,
 * optionally assigning a published POG version of the same organization.
 * Requires Idempotency-Key.
 */
export async function POST(request: Request, route: RouteContext<"/api/v1/stores/[store_id]/displays">) {
  const { store_id: storeId } = await route.params;
  return handleMutation(request, {
    schema: CreateDisplayRequest,
    routeScope: `POST /stores/${storeId}/displays`,
    successStatus: 201,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(storeId, "Store", requestId);
      return id.ok ? requireSomeManager(ctx, requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => createDisplay(service, ctx.user.id, storeId, body, requestId),
    resourceId: (display) => display.display_id,
  });
}
