import { ReplaceSlotsRequest } from "@display-refill/domain";
import { replacePogSlots } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin replaces the complete slot set of a draft. Requires
 * expected_revision (409 when stale) and Idempotency-Key. Published versions
 * are read-only (409). `confirm_coordinates: true` records that every slot
 * was reviewed after the reference image was replaced.
 */
export async function PUT(request: Request, route: RouteContext<"/api/v1/pog-versions/[version_id]/slots">) {
  const { version_id: versionId } = await route.params;
  return handleMutation(request, {
    schema: ReplaceSlotsRequest,
    routeScope: `PUT /pog-versions/${versionId}/slots`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(versionId, "POG version", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins edit POG drafts.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => replacePogSlots(service, ctx.user.id, versionId, body, requestId),
    resourceId: (version) => version.pog_version_id,
  });
}
