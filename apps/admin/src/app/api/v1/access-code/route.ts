import { AccessCodeAction } from "@display-refill/domain";
import {
  createServiceClient, fieldErrorsOf, fromDbError, jsonData, jsonError, jsonFailure, readJsonBody, resolveAdminOrganization, resolveRequestId,
} from "@display-refill/server";
import { authenticateApi } from "@/server/api-auth";

export const dynamic = "force-dynamic";

const FORBIDDEN = "Only organization admins manage the access code.";
const organizationParam = (request: Request) => new URL(request.url).searchParams.get("organization_id") ?? undefined;

/** The organization's access code (admins only). `code` is null until one is created. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: false });
  if (!auth.ok) return auth.response;
  const org = resolveAdminOrganization(auth.ctx.me, organizationParam(request), FORBIDDEN);
  if (!org.ok) return jsonFailure(org, requestId);
  const result = await createServiceClient(auth.ctx.config).rpc("access_code_read", { p_actor: auth.ctx.user.id, p_org: org.value });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}

/** `rotate` issues a new code (the old one stops working); `disable`/`enable` toggle joining. */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const org = resolveAdminOrganization(auth.ctx.me, organizationParam(request), FORBIDDEN);
  if (!org.ok) return jsonFailure(org, requestId);
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = AccessCodeAction.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const result = await createServiceClient(auth.ctx.config).rpc("access_code_mutate", {
    p_actor: auth.ctx.user.id, p_org: org.value, p_action: parsed.data.action, p_request_id: requestId,
  });
  return result.error ? jsonFailure(fromDbError(result.error), requestId) : jsonData(result.data, requestId);
}
