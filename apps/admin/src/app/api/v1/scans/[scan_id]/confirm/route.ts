import { scanMutation } from "@/server/scan-handlers";
export async function POST(request: Request, route: RouteContext<"/api/v1/scans/[scan_id]/confirm">) {
  return scanMutation(request, (await route.params).scan_id, "confirm");
}
