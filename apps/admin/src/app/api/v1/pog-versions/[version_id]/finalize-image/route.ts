import { FinalizePogImageRequest } from "@display-refill/domain";
import { finalizePogImage } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin finalizes an uploaded reference image: the server checks the actual
 * image, applies EXIF orientation and `rotation`, crops to `crop` (the
 * canonical display bounds), re-encodes it without metadata and records it
 * on the draft. Replacing the image of a draft with slots requires the slots
 * to be reviewed and confirmed before publication. Requires
 * expected_revision and Idempotency-Key.
 */
export async function POST(request: Request, route: RouteContext<"/api/v1/pog-versions/[version_id]/finalize-image">) {
  const { version_id: versionId } = await route.params;
  return handleMutation(request, {
    schema: FinalizePogImageRequest,
    routeScope: `POST /pog-versions/${versionId}/finalize-image`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(versionId, "POG version", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins upload POG reference images.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => finalizePogImage(service, ctx.user.id, versionId, body, requestId, ctx.logger),
    resourceId: (version) => version.pog_version_id,
  });
}
