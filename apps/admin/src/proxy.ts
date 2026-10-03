import { loadAdminServerConfig } from "@display-refill/server";
import { type NextRequest, NextResponse } from "next/server";
import { createSsrClient, isAuthCookie, REQUEST_PATH_HEADER } from "./server/ssr-client";

/**
 * Keeps the web session cookie fresh: when the access token has expired the
 * Supabase SSR client refreshes it once with the refresh token and writes the
 * new cookies to both the forwarded request and the response. A rejected
 * refresh clears the cookies, so pages see "signed out" and redirect to
 * /sign-in (which never redirects back, so there is no loop).
 *
 * This is not the authorization boundary: pages, route handlers and the API
 * verify the user and their memberships themselves.
 */
export async function proxy(request: NextRequest) {
  // Pages use the path to build the sign-in `next` value (validated again there).
  // Always overwritten, so a client cannot supply its own.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  };
  let response = forward();
  if (!request.cookies.getAll().some((c) => isAuthCookie(c.name))) return response;

  let config;
  try {
    config = loadAdminServerConfig();
  } catch {
    return response; // routes report CONFIGURATION_INVALID themselves
  }

  const supabase = createSsrClient(config, {
    getAll: () => request.cookies.getAll(),
    setAll(cookies, headers) {
      for (const { name, value } of cookies) request.cookies.set(name, value);
      response = forward();
      for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    },
  });
  // getUser() loads the session (refreshing it if expired) and verifies it with Supabase Auth.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/v1/health).*)"],
};
