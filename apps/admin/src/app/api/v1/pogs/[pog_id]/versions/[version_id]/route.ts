import { getPogVersion } from "@display-refill/server";
import { callerClient, handleRead, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * One POG version with its slots, reference dimensions and (for drafts)
 * publication blockers, as the caller may see it: admins see drafts,
 * managers published versions, employees versions their stores use.
 */
export async function GET(request: Request, route: RouteContext<"/api/v1/pogs/[pog_id]/versions/[version_id]">) {
  const { pog_id: pogId, version_id: versionId } = await route.params;
  return handleRead(request, async (ctx, _query, requestId) => {
    const pog = uuidParam(pogId, "POG version", requestId);
    if (!pog.ok) return pog;
    const id = uuidParam(versionId, "POG version", requestId);
    return id.ok ? getPogVersion(callerClient(ctx), versionId, pogId) : id;
  });
}
