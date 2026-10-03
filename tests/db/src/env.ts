import { execFileSync } from "node:child_process";

export interface LocalSupabase {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  dbUrl: string;
  /** Local-only HS256 secret; lets tests mint tokens (e.g. expired ones). */
  jwtSecret: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Connection details for the LOCAL Supabase stack (`supabase status`).
 * Refuses anything that is not a loopback address: these tests create users
 * and rows and must never touch a hosted project.
 */
export function localSupabase(): LocalSupabase {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: new URL("../../..", import.meta.url).pathname,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string | undefined>;
  const env = {
    apiUrl: status.API_URL ?? "",
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY ?? "",
    secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY ?? "",
    dbUrl: status.DB_URL ?? "",
    jwtSecret: status.JWT_SECRET ?? "",
  };
  for (const [name, value] of [["API_URL", env.apiUrl], ["DB_URL", env.dbUrl]] as const) {
    if (!value) throw new Error(`supabase status did not report ${name}; is local Supabase running?`);
    if (!LOCAL_HOSTS.has(new URL(value).hostname)) {
      throw new Error(`${name} is not a local address; refusing to run database tests against it.`);
    }
  }
  if (!env.publishableKey || !env.secretKey) throw new Error("supabase status did not report API keys");
  return env;
}
