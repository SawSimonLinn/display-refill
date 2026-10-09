import "server-only";
import type { Me } from "@display-refill/domain";
import {
  type AdminServerConfig,
  bearerToken,
  createCallerClient,
  hasActiveMembership,
  isSameOriginRequest,
  jsonError,
  jsonFailure,
  loadMe,
  type Logger,
  verifyAccessToken,
  type VerifiedUser,
} from "@display-refill/server";
import { getAdminConfig, getLogger } from "./config";
import { createSessionClient } from "./session";

export interface ApiContext {
  config: AdminServerConfig;
  logger: Logger;
  user: VerifiedUser;
  me: Me;
  via: "bearer" | "cookie";
  /** Verified access token, for caller-scoped (RLS) reads. Never logged. */
  accessToken: string;
}

type AuthOutcome = { ok: true; ctx: ApiContext } | { ok: false; response: Response };

/**
 * Authenticates an /api/v1 request and loads the caller's memberships.
 *
 * - iOS: `Authorization: Bearer <access token>`. Cookies are ignored.
 * - Web: the SSR session cookie. Mutations must also pass the same-origin
 *   check (CSRF), because cookies are sent automatically by the browser.
 *
 * Tokens are verified with Supabase Auth on every request, and memberships
 * are read fresh, so a revoked membership or a signed-out session is denied
 * on the next request. A caller with no active membership gets 403, except on
 * onboarding routes (`allowWithoutMembership`), where a new account redeems the
 * access code; those routes check the onboarding state in the database.
 */
export async function authenticateApi(
  request: Request,
  requestId: string,
  options: { mutation: boolean; allowWithoutMembership?: boolean },
): Promise<AuthOutcome> {
  const result = getAdminConfig();
  if (!result.ok) {
    getLogger().error("api: configuration invalid", { request_id: requestId, variables: result.error.problems.map((p) => p.variable) });
    return { ok: false, response: jsonError("CONFIGURATION_INVALID", "The server is missing required configuration. See the server log.", requestId) };
  }
  const config = result.config;
  const logger = getLogger();
  const unauthenticated = () => jsonError("UNAUTHENTICATED", "Sign in again.", requestId, { headers: { "www-authenticate": "Bearer" } });

  let accessToken: string;
  let via: ApiContext["via"];
  const bearer = bearerToken(request.headers);
  if (bearer === null) return { ok: false, response: unauthenticated() };
  if (bearer) {
    accessToken = bearer;
    via = "bearer";
  } else {
    if (options.mutation && !isSameOriginRequest(request.headers, config.appOrigin)) {
      logger.warn("api: cross-origin cookie mutation rejected", { request_id: requestId, path: new URL(request.url).pathname });
      return { ok: false, response: jsonError("FORBIDDEN", "Cross-site request rejected.", requestId) };
    }
    const supabase = await createSessionClient(config);
    const { data } = await supabase.auth.getSession(); // verified below, never trusted as-is
    if (!data.session) return { ok: false, response: unauthenticated() };
    accessToken = data.session.access_token;
    via = "cookie";
  }

  const verified = await verifyAccessToken(config, accessToken);
  if (!verified.ok) {
    if (verified.code === "UNAUTHENTICATED") return { ok: false, response: unauthenticated() };
    return { ok: false, response: jsonFailure(verified, requestId) };
  }
  const me = await loadMe(createCallerClient(config, accessToken), verified.value);
  if (!me.ok) return { ok: false, response: jsonFailure(me, requestId) };
  if (!options.allowWithoutMembership && !hasActiveMembership(me.value)) {
    return { ok: false, response: jsonError("FORBIDDEN", "Your access has been removed. Contact your administrator.", requestId) };
  }
  return { ok: true, ctx: { config, logger, user: verified.value, me: me.value, via, accessToken } };
}
