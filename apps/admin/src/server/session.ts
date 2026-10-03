import "server-only";
import { type Me, safeNextPath } from "@display-refill/domain";
import { type AdminServerConfig, createCallerClient, hasActiveMembership, loadMe, type VerifiedUser } from "@display-refill/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAdminConfig } from "./config";
import { createSsrClient, REQUEST_PATH_HEADER } from "./ssr-client";

/** SSR client bound to this request's cookies (writable in route handlers). */
export async function createSessionClient(config: AdminServerConfig) {
  const store = await cookies();
  return createSsrClient(config, {
    getAll: () => store.getAll(),
    setAll(list) {
      try {
        for (const { name, value, options } of list) store.set(name, value, options);
      } catch {
        // Server Components cannot set cookies; proxy.ts refreshes sessions on navigation.
      }
    },
  });
}

export type WebSession =
  | { state: "signed_out" }
  | { state: "unavailable" }
  | { state: "signed_in"; user: VerifiedUser; me: Me; accessToken: string };

/**
 * The verified web session for this request. `getUser()` validates the
 * cookie's access token with Supabase Auth; the decoded cookie is never
 * trusted on its own. Memberships are then read through a caller-scoped
 * client, so revocation applies on the next request.
 */
export const getWebSession = cache(async (): Promise<WebSession> => {
  const result = getAdminConfig();
  if (!result.ok) return { state: "unavailable" };
  const config = result.config;
  const supabase = await createSessionClient(config);
  const { data, error } = await supabase.auth.getUser();
  if (!data.user) {
    return error && error.status !== undefined && error.status >= 500 ? { state: "unavailable" } : { state: "signed_out" };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return { state: "signed_out" };
  const user = { id: data.user.id, email: data.user.email ?? null };
  const me = await loadMe(createCallerClient(config, accessToken), user);
  if (!me.ok) return { state: "unavailable" };
  return { state: "signed_in", user, me: me.value, accessToken };
});

/** Any signed-in user (e.g. setting a password after an invite link). */
export async function requireSignedIn(fallbackPath: string) {
  const session = await getWebSession();
  if (session.state === "unavailable") redirect("/sign-in?error=unavailable");
  if (session.state === "signed_out") {
    const requested = (await headers()).get(REQUEST_PATH_HEADER);
    redirect(`/sign-in?next=${encodeURIComponent(safeNextPath(requested, fallbackPath))}`);
  }
  return session;
}

/**
 * Dashboard pages: org admins and store managers. Employees (iOS users) and
 * users without an active membership go to /no-access.
 */
export async function requireDashboard(fallbackPath: string) {
  const session = await requireSignedIn(fallbackPath);
  if (!hasActiveMembership(session.me)) redirect("/no-access?reason=revoked");
  if (!session.me.capabilities.dashboard) redirect("/no-access?reason=employee");
  return session;
}

export const isAdmin = (me: Me) => me.capabilities.admin_organization_ids.length > 0;
