import { scanMutation } from "@/server/scan-handlers";
export async function PATCH(request: Request, route: RouteContext<"/api/v1/scans/[scan_id]/counts">) {
  return scanMutation(request, (await route.params).scan_id, "counts");
}
