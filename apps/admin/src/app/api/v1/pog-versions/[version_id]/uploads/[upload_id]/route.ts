import { createServiceClient, jsonData, jsonFailure, resolveRequestId, uploadPogReference } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";
import { requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/** Private POG reference bytes only; employee scan photos belong to Feature 08. */
export async function PUT(request: Request, route: RouteContext<"/api/v1/pog-versions/[version_id]/uploads/[upload_id]">) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const { version_id, upload_id } = await route.params;
  for (const [id, label] of [[version_id, "POG version"], [upload_id, "Upload"]]) {
    const valid = uuidParam(id!, label!, requestId);
    if (!valid.ok) return valid.response;
  }
  const allowed = requireSomeAdmin(auth.ctx, "Only organization admins upload POG reference images.", requestId);
  if (!allowed.ok) return allowed.response;
  const result = await uploadPogReference(createServiceClient(auth.ctx.config), auth.ctx.user.id, version_id, upload_id, request);
  return result.ok ? jsonData({ uploaded: true }, requestId) : jsonFailure(result, requestId);
}
