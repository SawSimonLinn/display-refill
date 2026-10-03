import { createServiceClient, pogImageAccess } from "@display-refill/server";
import { callerClient, handleAction, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * A five-minute signed link to a version's reference image, for any caller
 * who can read that version (employees: layouts their stores use). The link
 * is not stored; ask again when it expires.
 */
export async function POST(request: Request, route: RouteContext<"/api/v1/pog-versions/[version_id]/image-access">) {
  const { version_id: versionId } = await route.params;
  return handleAction(request, {
    successStatus: 200,
    prepare: (_ctx, requestId) => {
      const id = uuidParam(versionId, "POG version", requestId);
      return id.ok ? { ok: true, value: null } : id;
    },
    execute: (ctx) => pogImageAccess(callerClient(ctx), createServiceClient(ctx.config), versionId),
  });
}
