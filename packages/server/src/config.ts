import { looksLikeSupabaseSecretKey } from "@display-refill/domain";
import { z } from "zod";
import { MockVisionScenario } from "./vision";

/**
 * Server configuration validation. Messages name the variable and the rule it
 * broke, never the value, so they are safe to print and log.
 */
export class ConfigurationError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(service: string, problems: readonly ConfigProblem[]) {
    super(
      [
        `Invalid server configuration for ${service}:`,
        ...problems.map((p) => `  - ${p.variable}: ${p.problem}`),
        "Copy .env.example to .env.local (admin) or .env (worker) and fill in the listed variables. Values are never printed.",
      ].join("\n"),
    );
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

export interface ConfigProblem {
  variable: string;
  problem: string;
}

type Env = Record<string, string | undefined>;

const required = () => z.string({ error: "is required" }).trim().min(1, { error: "is required" });

const httpUrl = required().pipe(
  z.url({ protocol: /^https?$/, error: "must be an http:// or https:// URL" }),
);

const isOriginOnly = (value: string) => {
  try {
    return new URL(value).origin === value.replace(/\/$/, "");
  } catch {
    return false; // already reported by the URL check
  }
};

const origin = httpUrl.refine(isOriginOnly, {
  error: "must be an origin only, such as https://admin.example.com (no path, query or fragment)",
});

const postgresUrl = required().pipe(
  z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// or postgresql:// URL" }),
);

const publishableKey = required().refine((key) => !looksLikeSupabaseSecretKey(key), {
  error: "must be the publishable (anon) key; a secret/service-role key was supplied",
});

const secretKey = required();

const positiveDays = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === "" ? String(fallback) : value))
    .pipe(z.string().regex(/^[1-9][0-9]*$/, { error: "must be a whole number of days, at least 1" }))
    .transform(Number)
    .pipe(z.number().int().min(1).max(36500, { error: "must be at most 36500 days" }));

export const LogLevel = z.enum(["debug", "info", "warn", "error"], {
  error: "must be one of debug, info, warn, error",
});
export type LogLevel = z.infer<typeof LogLevel>;
const logLevel = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === "" ? "info" : value))
  .pipe(LogLevel);

const AdminServerEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: secretKey,
  APP_ORIGIN: origin,
  LOG_LEVEL: logLevel,
});

/**
 * Only the deterministic mock exists. Feature 09 keeps it that way until a
 * real provider passes a benchmark and data-handling review (decision D20/D66).
 */
export const VisionProvider = z.enum(["mock"], {
  error: "only 'mock' is available until a provider is benchmarked and approved",
});

const WorkerEnv = z.object({
  SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: secretKey,
  DATABASE_URL: postgresUrl,
  VISION_PROVIDER: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? "mock" : value))
    .pipe(VisionProvider),
  VISION_MOCK_SCENARIO: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? "mixed" : value))
    .pipe(z.enum(MockVisionScenario, { error: `must be one of ${MockVisionScenario.join(", ")}` })),
  VISION_MODEL: z.string().trim().optional(),
  VISION_API_KEY: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  SCAN_IMAGE_RETENTION_DAYS: positiveDays(90),
  SCAN_METADATA_RETENTION_DAYS: positiveDays(365),
  LOG_LEVEL: logLevel,
});

export interface AdminServerConfig {
  publicSupabaseUrl: string;
  publicSupabasePublishableKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  appOrigin: string;
  logLevel: LogLevel;
}

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  databaseUrl: string;
  visionProvider: z.infer<typeof VisionProvider>;
  visionMockScenario: MockVisionScenario;
  visionModel: string | undefined;
  visionApiKey: string | undefined;
  concurrency: number;
  cleanupBatchSize: number;
  scanImageRetentionDays: number;
  scanMetadataRetentionDays: number;
  logLevel: LogLevel;
}

function parseOrThrow<T extends z.ZodType>(service: string, schema: T, env: Env): z.output<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const seen = new Set<string>();
  const problems: ConfigProblem[] = [];
  for (const issue of result.error.issues) {
    const variable = String(issue.path[0] ?? "(environment)");
    if (seen.has(variable)) continue;
    seen.add(variable);
    problems.push({ variable, problem: issue.message });
  }
  throw new ConfigurationError(service, problems);
}

export function loadAdminServerConfig(env: Env = process.env): AdminServerConfig {
  const e = parseOrThrow("admin-api", AdminServerEnv, env);
  if (e.SUPABASE_SERVICE_ROLE_KEY === e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new ConfigurationError("admin-api", [
      { variable: "SUPABASE_SERVICE_ROLE_KEY", problem: "must differ from the publishable key" },
    ]);
  }
  return {
    publicSupabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL,
    publicSupabasePublishableKey: e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    appOrigin: e.APP_ORIGIN.replace(/\/$/, ""),
    logLevel: e.LOG_LEVEL,
  };
}

export function loadWorkerConfig(env: Env = process.env): WorkerConfig {
  const e = parseOrThrow("scan-worker", WorkerEnv, env);
  return {
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: e.DATABASE_URL,
    visionProvider: e.VISION_PROVIDER,
    visionMockScenario: e.VISION_MOCK_SCENARIO,
    visionModel: e.VISION_MODEL || undefined,
    visionApiKey: e.VISION_API_KEY || undefined,
    concurrency: e.WORKER_CONCURRENCY,
    cleanupBatchSize: e.CLEANUP_BATCH_SIZE,
    scanImageRetentionDays: e.SCAN_IMAGE_RETENTION_DAYS,
    scanMetadataRetentionDays: e.SCAN_METADATA_RETENTION_DAYS,
    logLevel: e.LOG_LEVEL,
  };
}
