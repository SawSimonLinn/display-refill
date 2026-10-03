#!/usr/bin/env node
// Runs an already-built Swift test binary against local synthetic data only.
// Builds the admin server first unless --no-build is given. No credentials are printed.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
const root = fileURLToPath(new URL("..", import.meta.url));
const binary = process.argv[2];
if (!binary) throw new Error("Usage: node scripts/run-ios-manual-tests.mjs /absolute/path/CoreTests [--no-build]");
if (!existsSync(binary)) throw new Error("Build the Swift test binary first.");
const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const status = JSON.parse(raw.slice(raw.indexOf("{")));
for (const field of ["API_URL", "DB_URL"]) {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(status[field]).hostname)) throw new Error("Local stack required.");
}
const port = Number(process.env.API_TEST_PORT ?? 3100);
const origin = `http://localhost:${port}`;
const serverEnv = {
  ...process.env, NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_URL: status.API_URL, SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  APP_ORIGIN: origin, NEXT_TELEMETRY_DISABLED: "1", LOG_LEVEL: "warn",
};
const next = `${root}/node_modules/.bin/next`;
if (!process.argv.includes("--no-build")) execFileSync(next, ["build"], { cwd: `${root}/apps/admin`, env: serverEnv, stdio: "inherit" });
try {
  await fetch(origin, { signal: AbortSignal.timeout(1000) });
  throw new Error("Test API port is already in use.");
} catch (error) {
  if (error.message === "Test API port is already in use.") throw error;
}
const server = spawn(next, ["start", "-p", String(port), "-H", "localhost"], { cwd: `${root}/apps/admin`, env: serverEnv, stdio: "ignore" });
const service = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ids = Object.fromEntries(["org", "store", "product", "pog", "version", "slot", "display"].map(k => [k, randomUUID()]));
const email = `swift-manual-${randomUUID()}@example.com`;
const password = randomBytes(24).toString("base64url");
let actor;
const checked = async promise => { const result = await promise; if (result.error) throw new Error(result.error.code ?? "Synthetic setup failed"); return result.data; };
try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`${origin}/api/v1/health`)).status === 200) break; } catch {}
    if (Date.now() > deadline) throw new Error("Local API did not start.");
    await new Promise(r => setTimeout(r, 500));
  }
  actor = (await checked(service.auth.admin.createUser({ email, password, email_confirm: true }))).user.id;
  await checked(service.from("organizations").insert({ id: ids.org, name: "Swift manual synthetic" }));
  await checked(service.from("organization_memberships").insert({ organization_id: ids.org, user_id: actor, role: "member" }));
  await checked(service.from("stores").insert({ id: ids.store, organization_id: ids.org, name: "Synthetic", store_number: "SWIFT", timezone: "UTC" }));
  await checked(service.from("store_memberships").insert({ organization_id: ids.org, store_id: ids.store, user_id: actor, role: "employee" }));
  await checked(service.from("products").insert({ id: ids.product, organization_id: ids.org, name: "Synthetic", short_name: "Syn", category: "fixture", container_type: "tub" }));
  await checked(service.from("pogs").insert({ id: ids.pog, organization_id: ids.org, name: "Synthetic" }));
  await checked(service.from("pog_versions").insert({ id: ids.version, organization_id: ids.org, pog_id: ids.pog, version_number: 1, reference_path: `${ids.org}/${ids.pog}/fixture.jpg`, reference_width: 100, reference_height: 100, reference_validated_at: new Date().toISOString(), slots_need_review: false }));
  await checked(service.from("pog_slots").insert({ id: ids.slot, organization_id: ids.org, pog_version_id: ids.version, product_id: ids.product, label: "A1", x: 0, y: 0, width: 1, height: 1, target_quantity: 3, refill_threshold: 1, sort_order: 0 }));
  await checked(service.from("pog_versions").update({ state: "published", published_at: new Date().toISOString() }).eq("id", ids.version));
  await checked(service.from("displays").insert({ id: ids.display, organization_id: ids.org, store_id: ids.store, name: "Synthetic", active_pog_version_id: ids.version }));
  const code = await new Promise(resolve => {
    const child = spawn(binary, [], { stdio: "inherit", env: {
      ...process.env, DISPLAY_REFILL_MANUAL_LIVE: "1", DISPLAY_REFILL_LIVE: "0",
      DYLD_LIBRARY_PATH: dirname(binary),
      LIVE_API_BASE_URL: origin, LIVE_SUPABASE_URL: status.API_URL,
      LIVE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
      LIVE_EMAIL: email, LIVE_PASSWORD: password, LIVE_DISPLAY_ID: ids.display,
    } });
    child.on("error", () => resolve(1));
    child.on("exit", code => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  // Retained scans reference their actor; revoke the synthetic identity's access.
  if (actor) {
    await service.from("store_memberships").update({ active: false }).eq("user_id", actor);
    await service.from("organization_memberships").update({ active: false }).eq("user_id", actor);
    await service.auth.admin.updateUserById(actor, { ban_duration: "876000h" });
  }
  server.kill("SIGTERM");
}
