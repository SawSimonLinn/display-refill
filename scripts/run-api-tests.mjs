#!/usr/bin/env node
// Builds and starts the admin app against the LOCAL Supabase stack, runs the
// black-box HTTP tests in tests/api, then stops the server.
//
//   npm run test:api                 build, start on :3100, test
//   npm run test:api -- --no-build   reuse the existing .next build
//
// Connection details come from `supabase status`; anything that is not a
// loopback address is refused, so this never touches a hosted project.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.API_TEST_PORT ?? 3100);
const origin = `http://localhost:${port}`;
const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const status = JSON.parse(raw.slice(raw.indexOf("{")));
for (const key of ["API_URL", "DB_URL", "MAILPIT_URL"]) {
  if (!status[key]) throw new Error(`supabase status did not report ${key}; is local Supabase running?`);
  if (!LOCAL.has(new URL(status[key]).hostname)) throw new Error(`${key} is not a loopback address; refusing to run.`);
}

try {
  const res = await fetch(origin, { signal: AbortSignal.timeout(1000) });
  await res.arrayBuffer();
  console.error(`Port ${port} is already in use. Stop that server or set API_TEST_PORT.`);
  process.exit(1);
} catch {
  // free
}

const serverEnv = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_URL: status.API_URL,
  SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  APP_ORIGIN: origin,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  NEXT_TELEMETRY_DISABLED: "1",
};

const admin = `${root}/apps/admin`;
const nextBin = `${root}/node_modules/.bin/next`; // not npx, so SIGTERM reaches the server
if (!process.argv.includes("--no-build")) {
  console.log("==> next build");
  execFileSync(nextBin, ["build"], { cwd: admin, env: serverEnv, stdio: "inherit" });
}

console.log(`==> next start on ${origin}`);
const server = spawn(nextBin, ["start", "-p", String(port), "-H", "localhost"], { cwd: admin, env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
const serverLog = [];
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => serverLog.push(String(chunk)));

let exitCode = 1;
try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${origin}/api/v1/health`);
      if (res.status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`server did not become healthy:\n${serverLog.join("")}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const vitestArgs = ["vitest", "run", ...process.argv.slice(2).filter((a) => a !== "--no-build")];
  exitCode = await new Promise((resolve) => {
    const tests = spawn("npx", vitestArgs, {
      cwd: `${root}/tests/api`,
      env: { ...process.env, ADMIN_BASE_URL: origin, MAILPIT_URL: status.MAILPIT_URL },
      stdio: "inherit",
    });
    tests.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  server.kill("SIGTERM");
  if (process.env.API_TEST_SERVER_LOG) console.log(serverLog.join(""));
}
process.exit(exitCode);
