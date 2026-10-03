import "server-only";
import { type AdminServerConfig, ConfigurationError, createLogger, loadAdminServerConfig, type Logger } from "@display-refill/server";

export type AdminConfigResult =
  | { ok: true; config: AdminServerConfig }
  | { ok: false; error: ConfigurationError };

let cached: AdminConfigResult | undefined;

/** Validates server configuration once per process. Never throws for bad config. */
export function getAdminConfig(): AdminConfigResult {
  if (!cached) {
    try {
      cached = { ok: true, config: loadAdminServerConfig() };
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      cached = { ok: false, error };
    }
  }
  return cached;
}

export function getLogger(): Logger {
  const result = getAdminConfig();
  return createLogger("admin-api", result.ok ? result.config.logLevel : "info");
}
