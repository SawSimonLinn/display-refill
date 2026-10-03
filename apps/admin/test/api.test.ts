import { ErrorEnvelope, findNonSnakeCaseKeys, HealthEnvelope } from "@display-refill/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "sb_secret_DO_NOT_PRINT_abcdef";
const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_example",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
  APP_ORIGIN: "http://localhost:3000",
};

async function loadHealth(env: Record<string, string>) {
  for (const key of Object.keys(VALID_ENV)) vi.stubEnv(key, env[key] ?? "");
  vi.resetModules(); // config is cached per process
  return (await import("@/app/api/v1/health/route")).GET;
}

describe("GET /api/v1/health", () => {
  let stderr: string[];
  beforeEach(() => {
    stderr = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void stderr.push(String(line)));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 200 with honest check statuses when configured", async () => {
    const GET = await loadHealth(VALID_ENV);
    const response = await GET(new Request("http://localhost/api/v1/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await response.json();
    expect(findNonSnakeCaseKeys(body)).toEqual([]);
    const { data, request_id } = HealthEnvelope.parse(body);
    expect(data.checks).toEqual({
      configuration: "ok",
      database: "not_checked",
      authentication: "not_checked",
      job_queue: "not_implemented",
    });
    expect(response.headers.get("x-request-id")).toBe(request_id);
  });

  it("returns 503 CONFIGURATION_INVALID without leaking names or values to the client", async () => {
    const GET = await loadHealth({ ...VALID_ENV, SUPABASE_SERVICE_ROLE_KEY: "", APP_ORIGIN: "not a url" });
    const response = await GET(new Request("http://localhost/api/v1/health"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(ErrorEnvelope.parse(JSON.parse(text)).error.code).toBe("CONFIGURATION_INVALID");
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    // The server log names the variables, but never values.
    const log = stderr.join("\n");
    expect(log).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(log).toContain("APP_ORIGIN");
    expect(log).not.toContain(SECRET);
  });
});

describe("unknown /api/v1 routes", () => {
  it("return a JSON 404 envelope", async () => {
    const { GET, POST } = await import("@/app/api/v1/[...path]/route");
    for (const handler of [GET, POST]) {
      const response = handler(new Request("http://localhost/api/v1/nope"));
      expect(response.status).toBe(404);
      expect(ErrorEnvelope.parse(await response.json()).error.code).toBe("NOT_FOUND");
    }
  });
});
