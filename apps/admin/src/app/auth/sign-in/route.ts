import { Email, safeNextPath } from "@display-refill/domain";
import { authFailure } from "@display-refill/server";
import { limits } from "@/server/auth-actions";
import { field, readForm, seeOther, withQuery } from "@/server/forms";
import { createSessionClient } from "@/server/session";

/** Email/password sign-in for the web. Sets httpOnly session cookies. */
export async function POST(request: Request) {
  const read = await readForm(request, "/sign-in");
  if (!read.ok) return read.response;
  const { config, logger, requestId, form } = read.ctx;
  const next = safeNextPath(field(form, "next"));
  const back = (error: string) => seeOther(config, withQuery("/sign-in", { error, next: next === "/" ? undefined : next }));

  const email = Email.safeParse(field(form, "email"));
  const password = field(form, "password");
  if (!email.success || password.length === 0 || password.length > 200) return back("invalid");

  const limited = limits.signInPerEmail.hit(email.data);
  if (!limited.allowed) return back("rate_limited");

  const supabase = await createSessionClient(config);
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.session) {
    const failure = authFailure(error);
    logger.info("sign-in: rejected", { request_id: requestId, auth_code: error?.code, status: error?.status });
    if (failure.code === "DEPENDENCY_UNAVAILABLE") return back("unavailable");
    return back(error?.status === 429 ? "rate_limited" : "invalid");
  }
  logger.info("sign-in: web session started", { request_id: requestId, user_id: data.user.id });
  return seeOther(config, next);
}
