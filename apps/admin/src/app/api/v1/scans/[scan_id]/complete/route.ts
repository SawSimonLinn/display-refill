import { manualMutation } from "@/server/scan-handlers";
export async function POST(request: Request, route: RouteContext<"/api/v1/scans/[scan_id]/complete">) { return manualMutation(request, (await route.params).scan_id); }
