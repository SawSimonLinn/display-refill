import { createHmac } from "node:crypto";
import { Me } from "@display-refill/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiUser, createHarness, type Harness, SEED } from "../src/harness";

// iOS-style requests: Authorization: Bearer <access token>, no cookies.
let h: Harness;
let users: Record<"adminA" | "managerA1" | "employeeA1" | "employeeA2" | "adminB" | "outsider", ApiUser>;

const storesOf = async (token: string) => {
  const res = await h.api("/api/v1/me", { token });
  expect(res.status, res.text).toBe(200);
  return (Me.parse(res.json.data).stores).map((s) => [s.store_id, s.role]);
};

beforeAll(async () => {
  h = await createHarness();
  users = {
    adminA: await h.user("admin-a", { org: { id: SEED.orgA, role: "admin" } }),
    managerA1: await h.user("manager-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] }),
    employeeA1: await h.user("employee-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] }),
    employeeA2: await h.user("employee-a2", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA2, role: "employee" }] }),
    adminB: await h.user("admin-b", { org: { id: SEED.orgB, role: "admin" } }),
    outsider: await h.user("outsider"),
  };
});
afterAll(() => h?.close());

describe("GET /api/v1/me with a bearer token", () => {
  it("returns only the stores each role may access", async () => {
    expect(await storesOf(users.adminA.token)).toEqual([[SEED.storeA1, "admin"], [SEED.storeA2, "admin"]]);
    expect(await storesOf(users.managerA1.token)).toEqual([[SEED.storeA1, "manager"]]);
    expect(await storesOf(users.employeeA1.token)).toEqual([[SEED.storeA1, "employee"]]);
    expect(await storesOf(users.employeeA2.token)).toEqual([[SEED.storeA2, "employee"]]);
    expect(await storesOf(users.adminB.token)).toEqual([[SEED.storeB1, "admin"]]);
  });

  it("reports dashboard capability from memberships only", async () => {
    const me = async (u: ApiUser) => Me.parse((await h.api("/api/v1/me", { token: u.token })).json.data).capabilities;
    expect(await me(users.adminA)).toEqual({ dashboard: true, admin_organization_ids: [SEED.orgA] });
    expect(await me(users.managerA1)).toEqual({ dashboard: true, admin_organization_ids: [] });
    expect(await me(users.employeeA1)).toEqual({ dashboard: false, admin_organization_ids: [] });
  });

  it("uses the envelope, no-store and request id conventions", async () => {
    const res = await h.api("/api/v1/me", { token: users.employeeA1.token });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBe(res.json.request_id);
  });
});

describe("rejected credentials", () => {
  it("401 without a token, with a malformed header, or with a garbage token", async () => {
    for (const headers of <Record<string, string>[]>[{}, { authorization: "Basic abc" }, { authorization: "Bearer not-a-jwt" }, { authorization: "Bearer a.b.c" }]) {
      const res = await h.api("/api/v1/me", { headers });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.json.error.code).toBe("UNAUTHENTICATED");
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
    }
  });

  it("401 for an expired token and for a token with a forged signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const mint = (exp: number, secret: string) => {
      const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
      const head = b64({ alg: "HS256", typ: "JWT" });
      const body = b64({ sub: users.adminA.id, role: "authenticated", aud: "authenticated", iat: now - 120, exp });
      return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
    };
    expect((await h.api("/api/v1/me", { token: mint(now - 60, h.env.jwtSecret) })).status).toBe(401);
    expect((await h.api("/api/v1/me", { token: mint(now + 600, "not-the-project-secret-but-long-enough-123") })).status).toBe(401);
    // A tampered payload on a real token is rejected too.
    const [head, , sig] = users.employeeA1.token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sub: users.adminA.id, role: "authenticated", exp: now + 600 })).toString("base64url");
    expect((await h.api("/api/v1/me", { token: `${head}.${forgedBody}.${sig}` })).status).toBe(401);
  });

  it("a token from a signed-out session is rejected before it expires", async () => {
    const u = await h.user("logout", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    expect((await h.api("/api/v1/me", { token: u.token })).status).toBe(200);
    const out = await fetch(`${h.env.apiUrl}/auth/v1/logout?scope=local`, {
      method: "POST", headers: { apikey: h.env.publishableKey, authorization: `Bearer ${u.token}` },
    });
    expect(out.status).toBe(204);
    expect((await h.api("/api/v1/me", { token: u.token })).status).toBe(401);
    // The refresh token is revoked as well.
    const refreshed = await fetch(`${h.env.apiUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", headers: { apikey: h.env.publishableKey, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: u.refreshToken }),
    });
    expect(refreshed.status).toBe(400);
  });
});

describe("revocation applies to the next request with the same token", () => {
  it("store revocation removes the store; organization revocation returns 403", async () => {
    const u = await h.user("revoke", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] });
    expect(await storesOf(u.token)).toEqual([[SEED.storeA1, "manager"]]);

    await h.service.from("store_memberships").update({ active: false }).eq("user_id", u.id);
    expect(await storesOf(u.token)).toEqual([]);

    await h.service.from("organization_memberships").update({ active: false }).eq("user_id", u.id);
    const res = await h.api("/api/v1/me", { token: u.token });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("FORBIDDEN");
  });

  it("a signed-in user with no membership at all gets 403", async () => {
    const res = await h.api("/api/v1/me", { token: users.outsider.token });
    expect(res.status).toBe(403);
  });
});

describe("client-editable metadata is never a role source", () => {
  it("setting user_metadata role/admin claims grants nothing", async () => {
    const u = await h.user("meta", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    const update = await fetch(`${h.env.apiUrl}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: h.env.publishableKey, authorization: `Bearer ${u.token}`, "content-type": "application/json" },
      body: JSON.stringify({ data: { role: "admin", org_role: "admin", organization_id: SEED.orgA, is_admin: true } }),
    });
    expect(update.status).toBe(200);
    const fresh = await h.signIn(u.email, u.password); // token now carries the edited user_metadata
    const me = Me.parse((await h.api("/api/v1/me", { token: fresh.access_token })).json.data);
    expect(me.capabilities).toEqual({ dashboard: false, admin_organization_ids: [] });
    expect(me.stores.map((s) => s.role)).toEqual(["employee"]);
    expect((await h.api("/api/v1/members", { token: fresh.access_token })).status).toBe(403);
  });
});

