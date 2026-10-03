import { cookies } from "next/headers";
import { readForm, seeOther } from "@/server/forms";
import { createSessionClient } from "@/server/session";
import { isAuthCookie } from "@/server/ssr-client";

/**
 * Ends the web session: revokes this session's refresh token with Supabase
 * Auth, deletes the session cookies even if that call fails, and asks the
 * browser to drop cached pages (Clear-Site-Data).
 */
export async function POST(request: Request) {
  const read = await readForm(request, "/");
  if (!read.ok) return read.response;
  const { config, logger, requestId } = read.ctx;

  const supabase = await createSessionClient(config);
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) logger.warn("sign-out: revoke failed; cookies cleared anyway", { request_id: requestId, status: error.status });

  const store = await cookies();
  for (const { name } of store.getAll()) if (isAuthCookie(name)) store.delete(name);
  return seeOther(config, "/sign-in?signed_out=1", { "clear-site-data": '"cache", "storage"' });
}
