import "server-only";
import { createCallerClient, createServiceClient, type DbClient } from "@display-refill/server";
import { getAdminConfig } from "./config";

/**
 * Caller-scoped client for dashboard pages: the same RLS-filtered reads the
 * API serves, as the signed-in user. Pages only render after
 * requireDashboard(), which already required valid configuration.
 */
export function sessionCaller(session: { accessToken: string }): DbClient {
  const config = getAdminConfig();
  if (!config.ok) throw new Error("server configuration is invalid");
  return createCallerClient(config.config, session.accessToken);
}

/**
 * Service-role client for signing private Storage links on pages. Only call
 * it after a caller-scoped read has shown the user may see the resource.
 */
export function pageServiceClient(): DbClient {
  const config = getAdminConfig();
  if (!config.ok) throw new Error("server configuration is invalid");
  return createServiceClient(config.config);
}

/** IANA zone names for the time zone input's suggestions (the database validates). */
export function timeZoneNames(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}
