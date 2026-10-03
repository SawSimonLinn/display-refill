import { AuthLinkType } from "@display-refill/domain";
import { field, readForm, seeOther } from "@/server/forms";
import { createSessionClient } from "@/server/session";

const TOKEN_HASH = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Exchanges an invite or recovery token hash for a session (server-side
 * verifyOtp), then sends the user to choose a password. Reached by POST from
 * /auth/confirm so link scanners that only GET cannot consume the token.
 */
export async function POST(request: Request) {
  const read = await readForm(request, "/auth/confirm");
  if (!read.ok) return read.response;
  const { config, logger, requestId, form } = read.ctx;

  const type = AuthLinkType.safeParse(field(form, "type"));
  const tokenHash = field(form, "token_hash");
  if (!type.success || !TOKEN_HASH.test(tokenHash)) return seeOther(config, "/auth/confirm?error=invalid");

  const supabase = await createSessionClient(config);
  const { data, error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
  if (error || !data.session) {
    logger.info("auth link: verification failed", { request_id: requestId, link_type: type.data, auth_code: error?.code });
    return seeOther(config, "/auth/confirm?error=expired");
  }
  logger.info("auth link: verified", { request_id: requestId, link_type: type.data, user_id: data.user?.id });
  return seeOther(config, `/account/password?from=${type.data}`);
}
