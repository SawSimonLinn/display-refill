import { analysisAction } from "@/server/scan-handlers";
export async function POST(request: Request, route: RouteContext<"/api/v1/scans/[scan_id]/manual-takeover">) {
  return analysisAction(request, (await route.params).scan_id, "takeover");
}
