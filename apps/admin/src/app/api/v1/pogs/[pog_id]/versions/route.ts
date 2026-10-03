import { CreatePogVersionRequest } from "@display-refill/domain";
import { createPogVersion } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin creates the POG's next draft: a copy of one of its published
 * versions (`source_version_id`, reference image and slots included) or a
 * blank draft (null). One open draft per POG; a second request is 409.
 * Requires Idempotency-Key.
 */
export async function POST(request: Request, route: RouteContext<"/api/v1/pogs/[pog_id]/versions">) {
  const { pog_id: pogId } = await route.params;
  return handleMutation(request, {
    schema: CreatePogVersionRequest,
    routeScope: `POST /pogs/${pogId}/versions`,
    successStatus: 201,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(pogId, "POG", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins create POG drafts.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => createPogVersion(service, ctx.user.id, pogId, body, requestId),
    resourceId: (version) => version.pog_version_id,
  });
}
