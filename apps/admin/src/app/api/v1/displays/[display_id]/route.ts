import { UpdateDisplayRequest } from "@display-refill/domain";
import { getDisplay, updateDisplay } from "@display-refill/server";
import { callerClient, handleMutation, handleRead, requireSomeManager, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/** Display, its store and the slots of the assigned published version, as the caller may see them. */
export async function GET(request: Request, route: RouteContext<"/api/v1/displays/[display_id]">) {
  const { display_id: displayId } = await route.params;
  return handleRead(request, async (ctx, _query, requestId) => {
    const id = uuidParam(displayId, "Display", requestId);
    return id.ok ? getDisplay(callerClient(ctx), displayId) : id;
  });
}

/**
 * A manager of the display's store (or an organization admin) renames,
 * archives/restores, assigns a published POG version or unassigns (null).
 * Store and organization come from the stored display. Requires
 * expected_revision (409 when stale) and Idempotency-Key.
 */
export async function PATCH(request: Request, route: RouteContext<"/api/v1/displays/[display_id]">) {
  const { display_id: displayId } = await route.params;
  return handleMutation(request, {
    schema: UpdateDisplayRequest,
    routeScope: `PATCH /displays/${displayId}`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(displayId, "Display", requestId);
      return id.ok ? requireSomeManager(ctx, requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => updateDisplay(service, ctx.user.id, displayId, body, requestId),
    resourceId: (display) => display.display_id,
  });
}
