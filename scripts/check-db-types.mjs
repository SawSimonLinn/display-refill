#!/usr/bin/env node
// Fails if packages/server/src/database.types.ts differs from types generated
// from the currently applied LOCAL schema. Run after `npm run db:reset`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const committedPath = "packages/server/src/database.types.ts";
const generated = execFileSync("npx", ["supabase", "gen", "types", "typescript", "--local", "--schema", "public"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const committed = readFileSync(new URL(`../${committedPath}`, import.meta.url), "utf8");
if (generated !== committed) {
  console.error(`${committedPath} does not match the local schema. Run \`npm run db:types\` and commit the result.`);
  process.exit(1);
}
console.log(`OK: ${committedPath} matches the applied local schema.`);
