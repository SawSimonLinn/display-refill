import { DisplayTypeAction } from "@display-refill/domain";
import {
  createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, readJsonBody, resolveAdminOrganization,
  resolveMemberOrganization, resolveRequestId,
} from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";

export const dynamic = "force-dynamic";

const organizationParam = (request: Request) => new URL(request.url).searchParams.get("organization_id") ?? undefined;

/** Display case types of the organization; admins also get each type's items and default PAR. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: false });
  if (!auth.ok) return auth.response;
  const org = resolveMemberOrganization(auth.ctx.me, organizationParam(request));
  if (!org.ok) return jsonFailure(org, requestId);
  const result = await createServiceClient(auth.ctx.config).rpc("display_types_read", { p_actor: auth.ctx.user.id, p_org: org.value });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}

/**
 * Admin: `save_type`, `save_item` or `move_item` (one place up or down). Edits carry `expected_revision`; new rows are unique by
 * code / product, so a repeated create is refused rather than duplicated. Item changes reach
 * every store using the type immediately (PAR only where the store has not overridden it).
 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const org = resolveAdminOrganization(auth.ctx.me, organizationParam(request), "Only organization admins manage display case types.");
  if (!org.ok) return jsonFailure(org, requestId);
  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = DisplayTypeAction.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const result = await createServiceClient(auth.ctx.config).rpc("display_type_mutate", {
    p_actor: auth.ctx.user.id, p_org: org.value, p_body: parsed.data, p_request_id: requestId,
  });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
