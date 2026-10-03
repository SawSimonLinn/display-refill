import { type AdminServerConfig, type Database } from "@display-refill/server";
import { type CookieMethodsServer, createServerClient } from "@supabase/ssr";

/**
 * Supabase SSR client over the request's cookies. Shared by proxy.ts (which
 * cannot import `server-only`) and server code.
 *
 * Session cookies are httpOnly: the browser never runs a Supabase client,
 * every sign-in/out and token refresh happens on the server.
 */
export function createSsrClient(config: AdminServerConfig, cookies: CookieMethodsServer) {
  return createServerClient<Database>(config.supabaseUrl, config.publicSupabasePublishableKey, {
    cookies,
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: config.appOrigin.startsWith("https://"),
    },
    auth: { detectSessionInUrl: false },
  });
}

/** Supabase Auth cookies (`sb-<ref>-auth-token`, possibly chunked as `.0`, `.1`, …). */
export const isAuthCookie = (name: string) => name.startsWith("sb-") && name.includes("-auth-token");

/** Set by proxy.ts on every forwarded request: path and query of the original URL. */
export const REQUEST_PATH_HEADER = "x-display-refill-path";
