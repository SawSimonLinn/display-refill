import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer" };
const apiURL = process.env.PRODUCTION_TEST_API_URL || "http://localhost:3000";
const suites = process.env.PRODUCTION_TEST_SUITE ? [process.env.PRODUCTION_TEST_SUITE] : ["ProductionWorkflowUITests", "PrepWorkflowUITests"];
if (suites.some(s => !["ProductionWorkflowUITests", "PrepWorkflowUITests", "BuildBookUITests", "WasteWorkflowUITests"].includes(s))) throw new Error("Unknown production UI suite.");
const local = url => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
if (!local(apiURL)) throw new Error("Refusing a non-local test API.");
const fixturePath = join(root, "apps/ios/Verification/ProductionFixture.json");
if (existsSync(fixturePath)) throw new Error("An existing ProductionFixture.json must be preserved. Remove/move your own fixture before running this harness.");
const health = await fetch(`${apiURL}/api/v1/health`);
if (!health.ok || (await health.json()).data?.status !== "ok") throw new Error("Local API health check failed; start the backend first.");
const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
if (!local(status.API_URL) || !local(status.DB_URL)) throw new Error("Refusing a non-local Supabase stack.");
const db = createClient(status.API_URL, status.SECRET_KEY || status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const check = async promise => { const result = await promise; if (result.error) throw new Error(result.error.message); return result.data; };
const org = randomUUID(), store = randomUUID();
const email = `production-simulator-${randomUUID()}@example.com`, password = randomBytes(24).toString("base64url");
const actor = (await check(db.auth.admin.createUser({ email, password, email_confirm: true }))).user.id;
await check(db.from("organizations").insert({ id: org, name: "Synthetic production simulator" }));
await check(db.from("organization_memberships").insert({ organization_id: org, user_id: actor, role: "admin" }));
await check(db.from("profiles").update({ display_name: "Synthetic prep teammate" }).eq("user_id", actor));
await check(db.from("stores").insert({ id: store, organization_id: org, name: "Synthetic production simulator", store_number: "SIM-PREP", timezone: "America/Los_Angeles" }));
const sections = ["fruit_mobile", "salad_mobile", "fruit_case", "veggie_case"];
let watermelon;
const mutate = body => check(db.rpc("production_mutate", { p_actor: actor, p_store: store, p_body: body, p_key: randomUUID() }));
for (const [index, section] of sections.entries()) {
 const product = randomUUID(); if (index === 0) watermelon = product;
 const name = ["Synthetic Watermelon Bowl", "Synthetic Cobb Salad", "Synthetic Pineapple Cup", "Synthetic Chopped Onion"][index];
 await check(db.from("products").insert({ id: product, organization_id: org, name, short_name: "Synthetic", category: "Synthetic", container_type: "Bowl" }));
 await mutate({ action: "configure", product_id: product, section, par: 10, category: index === 2 ? "Top row" : "Synthetic", product_type: "Bowl", sort_order: 0, active: true });
}
await mutate({ action: "configure", product_id: watermelon, section: "fruit_case", par: 36, category: "$5 bowls", product_type: "Bowl", sort_order: 2, active: true });
for (const [category, order] of [["2 for 6", 1], ["$10 bowls", 3], ["Party tray", 4]]) {
 const product = randomUUID();
 await check(db.from("products").insert({ id: product, organization_id: org, name: `Synthetic ${category}`, short_name: "Synthetic", category, container_type: "Bowl" }));
 await mutate({ action: "configure", product_id: product, section: "fruit_case", par: 10, category, product_type: "Bowl", sort_order: order, active: true });
}
for (const section of sections) {
 let c = await mutate({ action: "start", section });
 c = await mutate({ action: "counts", check_id: c.id, expected_revision: c.revision, items: c.items.map(i => ({ id: i.id, have: i.product_id === watermelon ? (section === "fruit_mobile" ? 5 : 16) : 10, ...(i.backup_required ? { backup: 0 } : {}) })) });
 await mutate({ action: "finish", check_id: c.id, expected_revision: c.revision });
}
const auth = createClient(status.API_URL, status.PUBLISHABLE_KEY || status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const session = await check(auth.auth.signInWithPassword({ email, password }));
const board = await fetch(`${apiURL}/api/v1/prep/${store}`, { headers: { authorization: `Bearer ${session.session.access_token}` } });
if (!board.ok || (await board.json()).data?.items.find(i => i.product_id === watermelon)?.remaining !== 25) throw new Error("Synthetic prep/API preflight failed.");
const devices = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], { env, encoding: "utf8" })).devices;
const available = Object.values(devices).flat();
const device = process.env.PRODUCTION_TEST_SIMULATOR_ID ? available.find(d => d.udid === process.env.PRODUCTION_TEST_SIMULATOR_ID) : available.find(d => d.name === "iPhone 17 Pro" && d.state === "Booted") || available.find(d => d.name === "iPhone 17 Pro");
if (!device) throw new Error("No iPhone 17 Pro simulator available; set PRODUCTION_TEST_SIMULATOR_ID for another installed simulator.");
const artifacts = mkdtempSync(join(tmpdir(), "production-prep-ui-"));
const logPath = join(artifacts, "xcodebuild.log"), bundlePath = join(artifacts, "results.xcresult");
writeFileSync(fixturePath, JSON.stringify({ email, password }), { mode: 0o600 });
try {
 execFileSync("xcodegen", ["generate"], { cwd: join(root, "apps/ios"), env, stdio: "inherit" });
 const log = openSync(logPath, "w");
 const result = spawnSync("xcodebuild", ["-project", "DisplayRefill.xcodeproj", "-scheme", "DisplayRefill", "-destination", `platform=iOS Simulator,id=${device.udid}`, "-derivedDataPath", join(tmpdir(), "feature07-ios-derived"), "-resultBundlePath", bundlePath, "-parallel-testing-enabled", "NO", "-collect-test-diagnostics", "never", ...suites.map(s => `-only-testing:DisplayRefillUITests/${s}`), "ARCHS=arm64", "ONLY_ACTIVE_ARCH=YES", "CODE_SIGN_IDENTITY=-", `API_BASE_URL=${apiURL}`, `SUPABASE_URL=${status.API_URL}`, `SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY || status.ANON_KEY}`, "test"], { cwd: join(root, "apps/ios"), env, stdio: ["ignore", log, log] });
 console.log(`Production simulator exit: ${result.status}; evidence: ${artifacts}`);
 process.exitCode = result.status ?? 1;
} finally {
 unlinkSync(fixturePath);
 execFileSync("xcodegen", ["generate"], { cwd: join(root, "apps/ios"), env, stdio: "inherit" });
 await auth.auth.signOut({ scope: "local" });
}
