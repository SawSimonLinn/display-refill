import { UpdatePogRequest } from "@display-refill/domain";
import { updatePog } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin renames or archives/restores a POG identity. Archiving blocks new
 * display assignments and publication; assigned displays keep their version.
 * Requires expected_revision and Idempotency-Key.
 */
export async function PATCH(request: Request, route: RouteContext<"/api/v1/pogs/[pog_id]">) {
  const { pog_id: pogId } = await route.params;
  return handleMutation(request, {
    schema: UpdatePogRequest,
    routeScope: `PATCH /pogs/${pogId}`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(pogId, "POG", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins can change POGs.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => updatePog(service, ctx.user.id, pogId, body, requestId),
    resourceId: (pog) => pog.pog_id,
  });
}
