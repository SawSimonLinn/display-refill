import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, SEED, waitForMail } from "../src/harness";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../../../scripts/bootstrap-admin.mjs", import.meta.url));
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h?.close());

async function bootstrap(args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run("node", [script, ...args], {
      env: { ...process.env, SUPABASE_URL: h.env.apiUrl, SUPABASE_SERVICE_ROLE_KEY: h.env.secretKey, APP_ORIGIN: h.base, ...env },
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

describe("operator first-admin bootstrap (scripts/bootstrap-admin.mjs)", () => {
  it("creates an organization with its first admin and sends the invitation", async () => {
    const email = `owner-${h.run}@example.com`;
    const result = await bootstrap(["--email", email, "--org-name", `Bootstrap Org ${h.run}`, "--display-name", "Owner"]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).not.toContain(h.env.secretKey);
    const orgId = /Organization ([0-9a-f-]{36})/.exec(result.out)![1]!;
    const row = await h.db.query(
      `select m.role, m.active from public.organization_memberships m join auth.users u on u.id = m.user_id where u.email = $1 and m.organization_id = $2`,
      [email, orgId],
    );
    expect(row.rows).toEqual([{ role: "admin", active: true }]);
    const mail = await waitForMail(email);
    expect(mail.links[0]).toContain(`${h.base}/auth/confirm?token_hash=`);
  });

  it("refuses an organization that already has an admin and leaves no new identity behind", async () => {
    const email = `takeover-${h.run}@example.com`;
    const result = await bootstrap(["--email", email, "--org-id", SEED.orgA]);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("already has an active admin");
    expect((await h.db.query("select 1 from auth.users where email = $1", [email])).rowCount).toBe(0);
  });

  it("refuses a non-loopback project without --confirm-remote, before any network call", async () => {
    const result = await bootstrap(["--email", `x-${randomUUID()}@example.com`, "--org-name", "X"], { SUPABASE_URL: "https://example.supabase.co" });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("--confirm-remote example.supabase.co");
  });

  it("validates its arguments", async () => {
    expect((await bootstrap(["--email", "not-an-email", "--org-name", "X"])).code).not.toBe(0);
    expect((await bootstrap(["--email", "a@example.com"])).out).toContain("exactly one of --org-name or --org-id");
    expect((await bootstrap(["--email", "a@example.com", "--org-id", "nope"])).out).toContain("--org-id must be a UUID");
  });
});
