import { getScan } from "@display-refill/server";
import { callerClient, handleRead, uuidParam } from "@/server/api-handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request, route: RouteContext<"/api/v1/scans/[scan_id]">) {
  const { scan_id } = await route.params;
  return handleRead(request, async (ctx, _query, requestId) => {
    const id = uuidParam(scan_id, "Scan", requestId);
    return id.ok ? getScan(callerClient(ctx), scan_id) : id;
  });
}
