import { jsonData, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";

export const dynamic = "force-dynamic";

/** Profile, organizations and accessible active stores of the verified caller. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: false });
  if (!auth.ok) return auth.response;
  return jsonData(auth.ctx.me, requestId);
}
