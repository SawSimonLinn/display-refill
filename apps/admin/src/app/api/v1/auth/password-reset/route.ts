import { PasswordResetRequest } from "@display-refill/domain";
import { fieldErrorsOf, jsonData, jsonError, readJsonBody, resolveRequestId } from "@display-refill/server";
import { getAdminConfig, getLogger } from "@/server/config";
import { clientKey, limits, requestPasswordReset } from "@/server/auth-actions";

export const dynamic = "force-dynamic";

/**
 * Password reset request for the iOS app (web uses the /forgot-password form).
 * Always 202 with the same body, so it does not reveal whether an account
 * exists. The email links to APP_ORIGIN/auth/confirm only; callers cannot
 * choose the redirect.
 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const config = getAdminConfig();
  if (!config.ok) return jsonError("CONFIGURATION_INVALID", "The server is missing required configuration. See the server log.", requestId);

  const body = await readJsonBody(request, 4096);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = PasswordResetRequest.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "Enter a valid email address.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });

  for (const limited of [await limits.passwordResetPerClient.hit(clientKey(request.headers)), await limits.passwordResetPerEmail.hit(parsed.data.email)]) {
    if (!limited.allowed) {
      return jsonError("RATE_LIMITED", "Too many reset requests. Try again later.", requestId, { headers: { "retry-after": String(limited.retryAfterSeconds) } });
    }
  }
  await requestPasswordReset(config.config, parsed.data.email, getLogger(), requestId);
  return jsonData({ status: "sent_if_registered" }, requestId, { status: 202 });
}
