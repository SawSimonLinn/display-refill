import { NewPassword } from "@display-refill/domain";
import { limits } from "@/server/auth-actions";
import { field, readForm, seeOther, withQuery } from "@/server/forms";
import { createSessionClient } from "@/server/session";

/** Sets a new password for the signed-in user (after an invite or recovery link, or voluntarily). */
export async function POST(request: Request) {
  const read = await readForm(request, "/account/password");
  if (!read.ok) return read.response;
  const { config, logger, requestId, form } = read.ctx;
  const from = field(form, "from") === "invite" ? "invite" : field(form, "from") === "recovery" ? "recovery" : undefined;
  const back = (error: string) => seeOther(config, withQuery("/account/password", { error, from }));

  const supabase = await createSessionClient(config);
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return seeOther(config, "/sign-in?error=expired&next=/account/password");

  const password = field(form, "password");
  if (!NewPassword.safeParse(password).success) return back("weak");
  if (password !== field(form, "confirm_password")) return back("mismatch");
  if (!(await limits.setPasswordPerUser.hit(userData.user.id)).allowed) return back("rate_limited");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logger.info("set password: rejected", { request_id: requestId, auth_code: error.code, status: error.status });
    return back(error.code === "same_password" ? "same" : error.code === "weak_password" ? "weak" : "failed");
  }
  logger.info("set password: updated", { request_id: requestId, user_id: userData.user.id });
  return seeOther(config, "/account/password?updated=1");
}
