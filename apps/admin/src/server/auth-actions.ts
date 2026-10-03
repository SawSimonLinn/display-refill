import "server-only";
import { type AdminServerConfig, createPublicClient, createRateLimiter, type Logger } from "@display-refill/server";

/**
 * Pilot rate limits (api-contracts.md: invitations and password-sensitive
 * operations are limited separately). Per process; Supabase Auth applies its
 * own sign-in and email limits as well.
 */
export const limits = {
  signInPerEmail: createRateLimiter({ limit: 10, windowMs: 5 * 60_000 }),
  passwordResetPerEmail: createRateLimiter({ limit: 3, windowMs: 15 * 60_000 }),
  passwordResetPerClient: createRateLimiter({ limit: 20, windowMs: 15 * 60_000 }),
  invitesPerActor: createRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
  setPasswordPerUser: createRateLimiter({ limit: 10, windowMs: 15 * 60_000 }),
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
