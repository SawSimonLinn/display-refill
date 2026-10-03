#!/usr/bin/env node
// Guards against package scripts that could reset, push to or otherwise target
// a hosted database. Database scripts must stay local-only.
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const manifests = ["package.json", "apps/admin/package.json", "packages/domain/package.json", "packages/server/package.json",
  "workers/scan-worker/package.json", "tests/db/package.json"];
const forbidden = [
  [/--linked\b/, "targets a linked (hosted) project"],
  [/--db-url\b/, "targets an arbitrary database URL"],
  [/\bdb\s+push\b/, "pushes migrations to a remote project"],
  [/\bsupabase\s+link\b/, "links a hosted project"],
  [/\bdb\s+reset\b(?![^&|;]*--local)/, "resets without --local"],
];

const problems = [];
for (const file of manifests) {
  const scripts = JSON.parse(readFileSync(new URL(file, root), "utf8")).scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    for (const [pattern, why] of forbidden) {
      if (pattern.test(command)) problems.push(`${file} "${name}": ${why}`);
    }
  }
}
if (problems.length) {
  console.error("Unsafe database scripts:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`OK: ${manifests.length} manifests contain no remote or non-local reset commands.`);
