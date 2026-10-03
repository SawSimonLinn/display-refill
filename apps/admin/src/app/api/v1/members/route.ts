import { Uuid } from "@display-refill/domain";
import { createServiceClient, jsonData, jsonError, jsonFailure, listMembers, resolveAdminOrganization, resolveRequestId } from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";

export const dynamic = "force-dynamic";

/** Organization roster (admin only). `?organization_id=` when the caller administers several. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: false });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const requested = new URL(request.url).searchParams.get("organization_id") ?? undefined;
  if (requested !== undefined && !Uuid.safeParse(requested).success) {
    return jsonError("VALIDATION_FAILED", "organization_id must be a UUID.", requestId, { fieldErrors: { organization_id: ["must be a UUID"] } });
  }
  const org = resolveAdminOrganization(ctx.me, requested);
  if (!org.ok) return jsonFailure(org, requestId);

  const members = await listMembers(createServiceClient(ctx.config), ctx.user.id, org.value);
  if (!members.ok) return jsonFailure(members, requestId);
  return jsonData({ organization_id: org.value, members: members.value }, requestId);
}
