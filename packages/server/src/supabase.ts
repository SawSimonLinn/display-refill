import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminServerConfig } from "./config";
import type { Database } from "./database.types";

export type DbClient = SupabaseClient<Database>;

/** Server-side clients never persist or auto-refresh sessions themselves. */
const STATELESS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

let serviceClient: { key: string; client: DbClient } | undefined;

/**
 * Service-role client. Bypasses RLS: every call made with it must be
 * preceded by an explicit organization/store authorization check, and the
 * trusted database functions re-check the actor themselves.
 */
export function createServiceClient(config: AdminServerConfig): DbClient {
  const key = `${config.supabaseUrl}|${config.supabaseServiceRoleKey}`;
  if (serviceClient?.key !== key) {
    serviceClient = { key, client: createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: STATELESS }) };
  }
  return serviceClient.client;
}

/** Publishable-key client with no user context (token verification, password reset requests). */
export function createPublicClient(config: AdminServerConfig): DbClient {
  return createClient<Database>(config.supabaseUrl, config.publicSupabasePublishableKey, { auth: STATELESS });
}

/**
 * Caller-scoped client: queries run as the verified user, so RLS applies.
 * Used for the caller's own reads.
 */
export function createCallerClient(config: AdminServerConfig, accessToken: string): DbClient {
  return createClient<Database>(config.supabaseUrl, config.publicSupabasePublishableKey, {
    auth: STATELESS,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
