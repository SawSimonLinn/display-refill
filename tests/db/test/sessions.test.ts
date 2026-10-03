import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@display-refill/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { type Client, createWorld, rows, type World } from "../src/world";

// Authorization is evaluated per request from membership rows, so a change
// takes effect for an already signed-in client on its next query.
let w: World;
let scanA2: string; // created by employeeA2 in store A2

const storeIds = async (c: Client) => (await rows<{ id: string }>(c.from("stores").select("id"))).map((r) => r.id).sort();

const b64url = (v: object | Buffer) => Buffer.from(v instanceof Buffer ? v : JSON.stringify(v)).toString("base64url");

/** HS256 access token for `sub`, signed with the LOCAL stack's secret. */
function mintToken(sub: string, expOffsetSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ sub, role: "authenticated", aud: "authenticated", iat: now - 120, exp: now + expOffsetSeconds });
  const sig = createHmac("sha256", w.env.jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const tokenClient = (token: string): Client =>
  createClient<Database>(w.env.apiUrl, w.env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

beforeAll(async () => {
  w = await createWorld();
  const created = await w.service.rpc("create_scan", { p_actor: w.users.employeeA2.id, p_display_id: SEED.displayA2, p_source: "manual" });
  if (created.error) throw created.error;
  scanA2 = created.data[0]!.scan_id;
});
afterAll(() => w?.close());

describe("membership changes apply to live sessions", () => {
  it("revoking a store membership hides the store on the next request with the same token", async () => {
    const u = await w.user("live-store", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    expect(await storeIds(u.client)).toEqual([SEED.storeA1]);
    const revoke = await w.service.from("store_memberships").update({ active: false }).eq("user_id", u.id);
    expect(revoke.error).toBeNull();
    expect(await storeIds(u.client)).toEqual([]);
    expect(await rows(u.client.from("displays").select("id"))).toEqual([]);
    expect(await rows(u.client.from("pog_versions").select("id"))).toEqual([]);
  });

  it("revoking the organization membership overrides an active store membership", async () => {
    const u = await w.user("live-org", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] });
    expect(await storeIds(u.client)).toEqual([SEED.storeA1]);
    const revoke = await w.service.from("organization_memberships").update({ active: false }).eq("user_id", u.id);
    expect(revoke.error).toBeNull();
    expect(await storeIds(u.client)).toEqual([]);
    expect(await rows(u.client.from("products").select("id"))).toEqual([]);
  });

  it("demoting an org admin removes organization-wide access immediately", async () => {
    const u = await w.user("live-admin", { org: { id: SEED.orgA, role: "admin" } });
    expect(await storeIds(u.client)).toEqual([SEED.storeA1, SEED.storeA2]);
    const demote = await w.service.from("organization_memberships").update({ role: "member" }).eq("user_id", u.id);
    expect(demote.error).toBeNull();
    expect(await storeIds(u.client)).toEqual([]);
    expect(await rows(u.client.from("audit_events").select("id"))).toEqual([]);
  });
});

describe("expired and forged tokens", () => {
  it("a validly signed, unexpired minted token works (control for the cases below)", async () => {
    expect(await storeIds(tokenClient(mintToken(w.users.employeeA1.id, 300)))).toEqual([SEED.storeA1]);
  });

  it("rejects an expired token for a user who still has access", async () => {
    const { data, error } = await tokenClient(mintToken(w.users.employeeA1.id, -60)).from("stores").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST303");
  });

  it("rejects a token with a tampered signature", async () => {
    const [head, body] = mintToken(w.users.adminA.id, 300).split(".");
    const { data, error } = await tokenClient(`${head}.${body}.${b64url(Buffer.alloc(32))}`).from("stores").select("id");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe("store boundaries within one organization", () => {
  it("a store A2 scan is visible to its store and the org admin only", async () => {
    const { adminA, managerA1, employeeA1, employeeA2, adminB } = w.users;
    const sees = async (c: Client) => (await rows(c.from("scans").select("id").eq("id", scanA2))).length === 1;
    expect(await sees(employeeA2.client)).toBe(true);
    expect(await sees(adminA.client)).toBe(true);
    expect(await sees(managerA1.client)).toBe(false);
    expect(await sees(employeeA1.client)).toBe(false);
    expect(await sees(adminB.client)).toBe(false);
    expect(await rows(managerA1.client.from("scan_slots").select("id").eq("scan_id", scanA2))).toEqual([]);
  });

  it("POG slots are not readable across organizations", async () => {
    const slotIds = async (c: Client) => (await rows<{ id: string }>(c.from("pog_slots").select("id"))).map((r) => r.id);
    expect(await slotIds(w.users.adminB.client)).not.toContain(SEED.slotA1);
    expect(await slotIds(w.users.adminB.client)).toContain(SEED.slotB1);
    expect(await slotIds(w.users.adminA.client)).not.toContain(SEED.slotB1);
  });
});
