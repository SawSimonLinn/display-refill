#!/usr/bin/env node
// Fails if server-only configuration could ship to a client:
//  1. the built admin browser bundle (apps/admin/.next/static), and
//  2. the iOS app's bundled configuration (Info.plist, xcconfig, project.yml).
// Set CHECK_SENTINELS to a comma-separated list of secret values used during
// the build to also prove those values were not inlined.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const FORBIDDEN = ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "VISION_API_KEY", "sb_secret_"];
const sentinels = (process.env.CHECK_SENTINELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const failures = [];
function scan(files, label) {
  let count = 0;
  for (const file of files) {
    count++;
    const text = readFileSync(file, "utf8");
    for (const needle of FORBIDDEN) if (text.includes(needle)) failures.push(`${relative(root, file)}: contains ${needle}`);
    for (const [i, value] of sentinels.entries()) if (text.includes(value)) failures.push(`${relative(root, file)}: contains sentinel #${i + 1}`);
  }
  console.log(`${label}: scanned ${count} file(s)`);
}

const staticDir = join(root, "apps/admin/.next/static");
if (!existsSync(staticDir)) {
  console.error("apps/admin/.next/static not found. Run `npm run build:admin` first.");
  process.exit(1);
}
scan([...walk(staticDir)].filter((f) => /\.(js|css|json|html|txt)$/.test(f)), "admin browser bundle");

const iosDir = join(root, "apps/ios");
scan(
  [...walk(iosDir)].filter((f) => !f.includes("/.build/") && /(Info\.plist|\.xcconfig|project\.yml)$/.test(f)),
  "iOS bundled configuration",
);

if (failures.length) {
  console.error("Server-only configuration found in client artifacts:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("OK: only publishable configuration found in client artifacts.");
