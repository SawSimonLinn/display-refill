import { createPogUploadIntent, createServiceClient } from "@display-refill/server";
import { handleAction, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin requests a write-once upload for a draft's new reference image.
 * Returns the staging path and authenticated API upload URL (PUT, image/jpeg, at most
 * 10 MiB). The upload expires after 10 minutes. Not idempotency-keyed: the
 * intent is short-lived; a retry simply issues another
 * upload (at most five pending per draft).
 */
export async function POST(request: Request, route: RouteContext<"/api/v1/pog-versions/[version_id]/upload-intent">) {
  const { version_id: versionId } = await route.params;
  return handleAction(request, {
    successStatus: 201,
    prepare: (ctx, requestId) => {
      const id = uuidParam(versionId, "POG version", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins upload POG reference images.", requestId) : id;
    },
    execute: (ctx, requestId) => createPogUploadIntent(createServiceClient(ctx.config), ctx.user.id, versionId, requestId, ctx.config.appOrigin),
  });
}
