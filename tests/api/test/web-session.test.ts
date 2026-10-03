import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiUser, CookieJar, createHarness, type Harness, SEED } from "../src/harness";

let h: Harness;
let adminA: ApiUser, managerA1: ApiUser, employeeA1: ApiUser;

beforeAll(async () => {
  h = await createHarness();
  adminA = await h.user("w-admin-a", { org: { id: SEED.orgA, role: "admin" } });
  managerA1 = await h.user("w-manager-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] });
  employeeA1 = await h.user("w-employee-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
});
afterAll(() => h?.close());

describe("sign-in form", () => {
  it("unauthenticated pages redirect to sign-in, which never redirects", async () => {
    const home = await h.page("/");
    expect(home.status).toBe(307);
    expect(home.location).toBe("/sign-in?next=%2F");
    const members = await h.page("/members");
    expect(members.location).toBe("/sign-in?next=%2Fmembers");
    const signIn = await h.page("/sign-in?next=%2Fmembers");
    expect(signIn.status).toBe(200);
    expect(signIn.html).not.toContain("Sign up");
  });

  it("rejects cross-origin and Origin-less posts without setting a session (login CSRF)", async () => {
    for (const origin of ["http://evil.example", null]) {
      const jar = new CookieJar();
      const res = await h.form("/auth/sign-in", { email: adminA.email, password: adminA.password }, { jar, origin });
      expect(res.status).toBe(303);
      expect(res.location).toBe(`${h.base}/sign-in?error=request`);
      expect(jar.authCookieNames()).toEqual([]);
    }
  });

  it("wrong password gives a generic error and no cookie", async () => {
    const jar = new CookieJar();
    const res = await h.form("/auth/sign-in", { email: adminA.email, password: "wrong-password-123" }, { jar });
    expect(res.location).toBe(`${h.base}/sign-in?error=invalid`);
    expect(jar.authCookieNames()).toEqual([]);
    const unknown = await h.form("/auth/sign-in", { email: `nobody-${h.run}@example.com`, password: "wrong-password-123" }, { jar });
    expect(unknown.location).toBe(res.location); // no account enumeration
  });

  it("sets an httpOnly, SameSite=Lax session cookie and opens the dashboard", async () => {
    const { jar, res } = await h.webSignIn(adminA);
    expect(res.location).toBe(`${h.base}/`);
    const cookieLines = jar.lastSetCookie.filter((l) => l.startsWith("sb-"));
    expect(cookieLines.length).toBeGreaterThan(0);
    for (const line of cookieLines) {
      expect(line).toMatch(/HttpOnly/i);
      expect(line).toMatch(/SameSite=Lax/i);
      expect(line).toMatch(/Path=\//i);
    }
    const home = await h.page("/", jar);
    expect(home.status).toBe(200);
    expect(home.html).toContain(adminA.email);
    expect(home.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("only follows allowlisted in-app `next` destinations", async () => {
    const cases: Array<[string, string]> = [
      ["/members", "/members"],
      ["https://evil.example/", "/"],
      ["//evil.example", "/"],
      ["/\\evil.example", "/"],
      ["/%2F%2Fevil.example", "/"],
      ["/sign-in", "/"],
    ];
    for (const [next, expected] of cases) {
      const { res } = await h.webSignIn(adminA, next);
      expect(res.location, next).toBe(`${h.base}${expected}`);
    }
  });
});

describe("dashboard access by capability", () => {
  it("admins see Members; managers see the dashboard but not Members; employees are sent to the iOS app", async () => {
    const admin = (await h.webSignIn(adminA)).jar;
    const adminMembers = await h.page("/members", admin);
    expect(adminMembers.status).toBe(200);
    expect(adminMembers.html).toContain("Invite someone");
    expect(adminMembers.html).toContain(managerA1.email);

    const manager = (await h.webSignIn(managerA1)).jar;
    const managerHome = await h.page("/", manager);
    expect(managerHome.status).toBe(200);
    expect(managerHome.html).toContain("A Store 1");
    expect(managerHome.html).not.toContain("A Store 2"); // store selector lists authorized stores only
    expect(managerHome.html).not.toContain('href="/members"');
    const managerMembers = await h.page("/members", manager);
    expect(managerMembers.html).toContain("Only organization admins can manage members.");
    expect(managerMembers.html).not.toContain(employeeA1.email);

    const employee = (await h.webSignIn(employeeA1)).jar;
    for (const path of ["/", "/members", "/stores", "/pogs"]) {
      const res = await h.page(path, employee);
      expect(res.status, path).toBe(307);
      expect(res.location).toBe("/no-access?reason=employee");
    }
    expect((await h.page("/no-access?reason=employee", employee)).status).toBe(200);
  });

  it("revoking membership takes effect on the next page load for an existing web session", async () => {
    const u = await h.user("w-revoke", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] });
    const { jar } = await h.webSignIn(u);
    expect((await h.page("/", jar)).status).toBe(200);
    await h.service.from("organization_memberships").update({ active: false }).eq("user_id", u.id);
    const res = await h.page("/", jar);
    expect(res.location).toBe("/no-access?reason=revoked");
    expect((await h.api("/api/v1/me", { jar })).status).toBe(403);
  });
});

describe("session refresh", () => {
  it("an expired access token is refreshed once and the new session cookie is returned", async () => {
    const { jar } = await h.webSignIn(managerA1);
    const before = jar.session();
    jar.setSession({ ...before, expires_at: Math.floor(Date.now() / 1000) - 60 });
    const res = await h.page("/", jar);
    expect(res.status).toBe(200);
    const after = jar.session();
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    expect(after.expires_at).toBeGreaterThan(Date.now() / 1000);
    // The new session works for the API too.
    expect((await h.api("/api/v1/me", { jar })).status).toBe(200);
  });

  it("an invalid refresh token clears the session and lands on sign-in without a loop", async () => {
    const { jar } = await h.webSignIn(managerA1);
    jar.setSession({ ...jar.session(), expires_at: Math.floor(Date.now() / 1000) - 60, refresh_token: "invalid-refresh-token" });
    const res = await h.page("/", jar);
    expect(res.status).toBe(307);
    expect(res.location).toBe("/sign-in?next=%2F");
    expect(jar.authCookieNames()).toEqual([]); // cleared by the response
    const signIn = await h.page(res.location!, jar);
    expect(signIn.status).toBe(200); // terminal: no redirect back
  });

  it("the API answers 401 (not a redirect) for a cookie whose refresh fails", async () => {
    const { jar } = await h.webSignIn(managerA1);
    jar.setSession({ ...jar.session(), expires_at: Math.floor(Date.now() / 1000) - 60, refresh_token: "invalid-refresh-token" });
    const res = await h.api("/api/v1/me", { jar });
    expect(res.status).toBe(401);
  });
});

describe("sign-out", () => {
  it("rejects cross-origin sign-out (no forced logout)", async () => {
    const { jar } = await h.webSignIn(managerA1);
    const res = await h.form("/auth/sign-out", {}, { jar, origin: "http://evil.example" });
    expect(res.location).toBe(`${h.base}/?error=request`);
    expect((await h.page("/", jar)).status).toBe(200);
  });

  it("revokes the session, clears cookies and cached data, and old tokens stop working", async () => {
    const { jar } = await h.webSignIn(managerA1);
    const stolen = jar.clone();
    const { access_token } = jar.session();
    const res = await h.form("/auth/sign-out", {}, { jar });
    expect(res.status).toBe(303);
    expect(res.location).toBe(`${h.base}/sign-in?signed_out=1`);
    expect(res.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(jar.authCookieNames()).toEqual([]);
    expect((await h.page("/", jar)).location).toBe("/sign-in?next=%2F");
    // A copy of the old cookie or its access token no longer authenticates.
    expect((await h.api("/api/v1/me", { token: access_token })).status).toBe(401);
    expect((await h.page("/", stolen)).location).toBe("/sign-in?next=%2F");
  });
});
