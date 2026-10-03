import { describe, expect, it } from "vitest";
import { ConfigurationError, loadAdminServerConfig, loadWorkerConfig } from "../src";

const SECRET = "sb_secret_DO_NOT_PRINT_1234567890";
const DB_PASSWORD = "hunter2-DO-NOT-PRINT";
const fakeJwt = (payload: object) =>
  ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

const adminEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_example",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
  APP_ORIGIN: "http://localhost:3000",
};

const workerEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
  DATABASE_URL: `postgresql://postgres:${DB_PASSWORD}@127.0.0.1:54322/postgres`,
};

function configError(fn: () => unknown): ConfigurationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigurationError) return error;
    throw error;
  }
  throw new Error("expected ConfigurationError");
}

describe("loadAdminServerConfig", () => {
  it("accepts a complete environment and applies defaults", () => {
    const config = loadAdminServerConfig({ ...adminEnv, APP_ORIGIN: "http://localhost:3000/" });
    expect(config.appOrigin).toBe("http://localhost:3000");
    expect(config.logLevel).toBe("info");
  });

  it("lists every missing variable by name", () => {
    const error = configError(() => loadAdminServerConfig({}));
    expect(error.problems.map((p) => p.variable).sort()).toEqual([
      "APP_ORIGIN",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
    ]);
    expect(error.message).toContain("SUPABASE_SERVICE_ROLE_KEY: is required");
    expect(error.message).toContain(".env.example");
  });

  it("treats blank values as missing", () => {
    const error = configError(() => loadAdminServerConfig({ ...adminEnv, SUPABASE_SERVICE_ROLE_KEY: "   " }));
    expect(error.problems).toEqual([{ variable: "SUPABASE_SERVICE_ROLE_KEY", problem: "is required" }]);
  });

  it.each([
    ["new-style secret key", SECRET],
    ["legacy service_role JWT", fakeJwt({ role: "service_role" })],
  ])("rejects a %s in the public publishable variable without printing it", (_label, key) => {
    const error = configError(() => loadAdminServerConfig({ ...adminEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }));
    expect(error.problems[0]?.variable).toBe("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(error.message).not.toContain(key);
    expect(error.message).not.toContain(SECRET);
  });

  it("accepts a legacy anon JWT as publishable", () => {
    expect(() => loadAdminServerConfig({ ...adminEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fakeJwt({ role: "anon" }) })).not.toThrow();
  });

  it("rejects APP_ORIGIN with a path", () => {
    const error = configError(() => loadAdminServerConfig({ ...adminEnv, APP_ORIGIN: "https://admin.example.com/app" }));
    expect(error.problems[0]?.variable).toBe("APP_ORIGIN");
  });

  it("rejects a service key equal to the publishable key", () => {
    const error = configError(() => loadAdminServerConfig({ ...adminEnv, SUPABASE_SERVICE_ROLE_KEY: adminEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }));
    expect(error.problems[0]?.variable).toBe("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("loadWorkerConfig", () => {
  it("defaults to the mock provider and documented retention", () => {
    const config = loadWorkerConfig(workerEnv);
    expect(config.visionProvider).toBe("mock");
    expect(config.scanImageRetentionDays).toBe(90);
    expect(config.scanMetadataRetentionDays).toBe(365);
  });

  it("rejects malformed values without echoing them", () => {
    const badDb = `mysql://root:${DB_PASSWORD}@db/x`;
    const error = configError(() =>
      loadWorkerConfig({
        ...workerEnv,
        DATABASE_URL: badDb,
        VISION_PROVIDER: "openai",
        SCAN_IMAGE_RETENTION_DAYS: "1.5",
        LOG_LEVEL: "loud",
      }),
    );
    expect(error.problems.map((p) => p.variable).sort()).toEqual([
      "DATABASE_URL",
      "LOG_LEVEL",
      "SCAN_IMAGE_RETENTION_DAYS",
      "VISION_PROVIDER",
    ]);
    for (const secretish of [DB_PASSWORD, badDb, SECRET]) {
      expect(error.message).not.toContain(secretish);
    }
  });
});

describe("malformed URLs", () => {
  it("report a config problem instead of throwing", () => {
    const error = configError(() => loadAdminServerConfig({ ...adminEnv, APP_ORIGIN: "not a url" }));
    expect(error.problems).toEqual([{ variable: "APP_ORIGIN", problem: "must be an http:// or https:// URL" }]);
  });
});
