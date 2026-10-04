import { photoHandler } from "@/server/photo-handlers";
export async function POST(request: Request, context: { params: Promise<{ scan_id: string }> }) {
 const { scan_id } = await context.params; return photoHandler(request, "renew", scan_id);
}
