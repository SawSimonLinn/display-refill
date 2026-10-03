import { PublishPogVersionRequest } from "@display-refill/domain";
import { publishPogVersion } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin publishes a draft. The database validates the reference image,
 * slots, products, targets and triggers and freezes the version in one
 * transaction. Publishing does not assign the version to any display
 * (managers do that with PATCH /displays/:id). Requires expected_revision and
 * Idempotency-Key.
 */
export async function POST(request: Request, route: RouteContext<"/api/v1/pog-versions/[version_id]/publish">) {
  const { version_id: versionId } = await route.params;
  return handleMutation(request, {
    schema: PublishPogVersionRequest,
    routeScope: `POST /pog-versions/${versionId}/publish`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(versionId, "POG version", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins publish POGs.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => publishPogVersion(service, ctx.user.id, versionId, body, requestId),
    resourceId: (version) => version.pog_version_id,
  });
}
