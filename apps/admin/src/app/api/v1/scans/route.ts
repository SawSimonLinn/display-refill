import { readJsonBody, jsonError, resolveRequestId } from "@display-refill/server";
import { manualMutation } from "@/server/scan-handlers";
import { photoHandler } from "@/server/photo-handlers";
export async function POST(request: Request) {
  const parsed = await readJsonBody(request.clone());
  if (!parsed.ok) return jsonError(parsed.code, parsed.message, resolveRequestId(request.headers));
  const body = parsed.value as { source?: string } | null;
  return body?.source === "photo" ? photoHandler(request, "create") : manualMutation(request);
}
