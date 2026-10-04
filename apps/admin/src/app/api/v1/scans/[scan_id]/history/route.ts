import { scanRecord } from "@/server/scan-handlers";
export const dynamic = "force-dynamic";
export async function GET(request: Request, route: RouteContext<"/api/v1/scans/[scan_id]/history">) {
  const { scan_id } = await route.params;
  return scanRecord(request, scan_id);
}
