import "server-only";
import { createHmac } from "node:crypto";
import { getAdminConfig } from "./config";
import { type AdminServerConfig, createPublicClient, createServiceClient, type Logger } from "@display-refill/server";

/**
 * Pilot rate limits (api-contracts.md: invitations and password-sensitive
 * operations are limited separately). Shared Postgres windows; Supabase Auth applies its
 * own sign-in and email limits as well.
 */
export const limits = {
  signInPerEmail: sharedLimit({ scope: "sign-in", limit: 10, windowMs: 5 * 60_000 }),
  passwordResetPerEmail: sharedLimit({ scope: "reset-email", limit: 3, windowMs: 15 * 60_000 }),
  passwordResetPerClient: sharedLimit({ scope: "reset-client", limit: 20, windowMs: 15 * 60_000 }),
  invitesPerActor: sharedLimit({ scope: "invite", limit: 30, windowMs: 10 * 60_000 }),
  setPasswordPerUser: sharedLimit({ scope: "set-password", limit: 10, windowMs: 15 * 60_000 }),
};

/** Best-effort client key. Only meaningful behind a proxy that sets X-Forwarded-For. */
export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** The only redirect target the server ever sends to Supabase Auth for email links. */
export const confirmUrl = (config: AdminServerConfig) => `${config.appOrigin}/auth/confirm`;

/**
 * Sends a recovery email when the account exists. The caller always gets the
 * same answer, so the response does not reveal which emails are registered.
 */
export async function requestPasswordReset(config: AdminServerConfig, email: string, logger: Logger, requestId: string) {
  const { error } = await createPublicClient(config).auth.resetPasswordForEmail(email, { redirectTo: confirmUrl(config) });
  if (error) {
    logger.warn("password reset: request failed", { request_id: requestId, status: error.status, auth_code: error.code });
  }
}

function sharedLimit(options: { scope: string; limit: number; windowMs: number }) {
  return { async hit(key: string) {
    const loaded = getAdminConfig();
    if (!loaded.ok) return { allowed: false, retryAfterSeconds: 60 };
    const hash = createHmac("sha256", loaded.config.supabaseServiceRoleKey).update(`${options.scope}:${key.toLowerCase()}`).digest("hex");
    const r = await createServiceClient(loaded.config).rpc("hit_operation_limit", {
      p_hash: hash, p_limit: options.limit, p_seconds: options.windowMs / 1000,
    });
    // A database outage must not bypass auth throttling.
    return { allowed: !r.error && r.data === 0, retryAfterSeconds: r.error ? 60 : r.data ?? 60 };
  } };
}
