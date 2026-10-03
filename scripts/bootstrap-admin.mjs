#!/usr/bin/env node
// Operator-only: provision the FIRST admin of an organization.
// Procedure and safeguards: context/operations-runbook.md ("First admin bootstrap").
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… APP_ORIGIN=… \
//     node scripts/bootstrap-admin.mjs --email owner@example.com --org-name "Example Foods"
//   … --org-id <uuid>              use an existing organization that has no active admin
//   … --display-name "Pat Owner"   optional
//   … --confirm-remote <hostname>  required when SUPABASE_URL is not a loopback address
//
// The identity gets an invitation email (link to APP_ORIGIN/auth/confirm) unless it
// already exists. The database function refuses an organization that already has an
// active admin, so this cannot be used to take over an organization. Later admins
// are invited through the Members page / API.
import { createClient } from "@supabase/supabase-js";

const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) fail(`unexpected argument ${JSON.stringify(flag)}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${flag} needs a value`);
    out[flag.slice(2)] = value;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const allowed = new Set(["email", "org-name", "org-id", "display-name", "confirm-remote"]);
for (const key of Object.keys(args)) if (!allowed.has(key)) fail(`unknown option --${key}`);

const email = (args.email ?? "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("--email must be an email address");
if (Boolean(args["org-name"]) === Boolean(args["org-id"])) fail("give exactly one of --org-name or --org-id");
if (args["org-id"] && !UUID.test(args["org-id"])) fail("--org-id must be a UUID");
if (args["org-name"] !== undefined && args["org-name"].trim().length === 0) fail("--org-name must not be empty");

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const appOrigin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
for (const [name, value] of [["SUPABASE_URL", supabaseUrl], ["SUPABASE_SERVICE_ROLE_KEY", serviceKey], ["APP_ORIGIN", appOrigin]]) {
  if (!value) fail(`${name} is required (values are never printed)`);
}
let target;
let origin;
try {
  target = new URL(supabaseUrl);
  origin = new URL(appOrigin);
} catch {
  fail("SUPABASE_URL and APP_ORIGIN must be URLs");
}
if (origin.origin !== appOrigin) fail("APP_ORIGIN must be an origin only (no path)");
if (!LOCAL.has(target.hostname) && args["confirm-remote"] !== target.hostname) {
  fail(`SUPABASE_URL points at ${target.hostname}. Re-run with --confirm-remote ${target.hostname} if this is the intended project.`);
}

console.log(`Target Supabase: ${target.host}${LOCAL.has(target.hostname) ? " (local)" : " (REMOTE, confirmed)"}`);
const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(address) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`could not list users: ${error.message}`);
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === address);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

let userId;
let invitedNow = false;
const invited = await service.auth.admin.inviteUserByEmail(email, {
  redirectTo: `${appOrigin}/auth/confirm`,
  data: args["display-name"] ? { display_name: args["display-name"].slice(0, 200) } : undefined,
});
if (invited.data?.user) {
  userId = invited.data.user.id;
  invitedNow = true;
  console.log("Invitation email sent.");
} else if (invited.error?.code === "email_exists" || invited.error?.code === "user_already_exists") {
  userId = await findUserId(email);
  if (!userId) fail("the email is registered but the identity could not be found");
  console.log("Identity already exists; no email sent. The user signs in with their existing password (or uses Forgot password).");
} else {
  fail(`invitation failed: ${invited.error?.code ?? invited.error?.message ?? "unknown error"}`);
}

const { data: orgId, error } = await service.rpc("bootstrap_first_admin", {
  p_user: userId,
  p_org: args["org-id"] ?? null,
  p_org_name: args["org-name"] ?? null,
});
if (error) {
  if (invitedNow) await service.auth.admin.deleteUser(userId); // leave nothing half-provisioned
  const reason = {
    CONFLICT: "the organization already has an active admin; invite further admins from the Members page",
    NOT_FOUND: "organization not found or inactive",
    VALIDATION_FAILED: "invalid organization name",
  }[error.message] ?? error.message;
  fail(reason);
}
console.log(`Organization ${orgId}: ${email} is now its admin (user ${userId}). Audited as membership.bootstrapped.`);
