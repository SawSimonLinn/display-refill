import { photoHandler } from "@/server/photo-handlers";
export async function PUT(request: Request, context: { params: Promise<{ scan_id: string }> }) {
 const { scan_id } = await context.params; return photoHandler(request, "upload", scan_id);
}
export async function GET(request: Request, context: { params: Promise<{ scan_id: string }> }) {
 const { scan_id } = await context.params; return photoHandler(request, "access", scan_id);
}
