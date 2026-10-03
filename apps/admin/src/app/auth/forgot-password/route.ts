import { Email } from "@display-refill/domain";
import { clientKey, limits, requestPasswordReset } from "@/server/auth-actions";
import { field, readForm, seeOther } from "@/server/forms";

/**
 * Web password reset request. The email link always targets
 * APP_ORIGIN/auth/confirm; nothing in the form chooses the redirect. The
 * answer is the same whether or not the account exists.
 */
export async function POST(request: Request) {
  const read = await readForm(request, "/forgot-password");
  if (!read.ok) return read.response;
  const { config, logger, requestId, form } = read.ctx;

  const email = Email.safeParse(field(form, "email"));
  if (!email.success) return seeOther(config, "/forgot-password?error=invalid");
  for (const limited of [limits.passwordResetPerClient.hit(clientKey(request.headers)), limits.passwordResetPerEmail.hit(email.data)]) {
    if (!limited.allowed) return seeOther(config, "/forgot-password?error=rate_limited");
  }
  await requestPasswordReset(config, email.data, logger, requestId);
  return seeOther(config, "/forgot-password?sent=1");
}
