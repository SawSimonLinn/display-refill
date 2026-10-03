import { randomUUID } from "node:crypto";
import { Me, Member } from "@display-refill/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiUser, createHarness, type Harness, mailsTo, SEED, waitForMail } from "../src/harness";

let h: Harness;
let adminA: ApiUser, managerA1: ApiUser, employeeA1: ApiUser, adminB: ApiUser;

const key = () => randomUUID();
const orgMembership = async (user: string, org: string = SEED.orgA) =>
  (await h.db.query<{ role: string; active: boolean; revision: number }>(
    "select role, active, revision from public.organization_memberships where organization_id = $1 and user_id = $2", [org, user],
  )).rows[0];
const authUserByEmail = async (email: string) =>
  (await h.db.query<{ id: string }>("select id from auth.users where email = $1", [email])).rows;

beforeAll(async () => {
  h = await createHarness();
  adminA = await h.user("m-admin-a", { org: { id: SEED.orgA, role: "admin" } });
  managerA1 = await h.user("m-manager-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] });
  employeeA1 = await h.user("m-employee-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
  adminB = await h.user("m-admin-b", { org: { id: SEED.orgB, role: "admin" } });
});
afterAll(() => h?.close());

describe("only organization admins manage members", () => {
  it("employees and managers get 403 on every members route and nothing changes", async () => {
    for (const u of [employeeA1, managerA1]) {
      expect((await h.api("/api/v1/members", { token: u.token })).status).toBe(403);
      const invite = await h.api("/api/v1/members/invite", {
        method: "POST", token: u.token, headers: { "idempotency-key": key() },
        body: { email: `nope-${h.run}-${randomUUID().slice(0, 4)}@example.com`, org_role: "admin", stores: [] },
      });
      expect(invite.status).toBe(403);
      const before = await orgMembership(u.id);
      // Self-escalation through the API.
      const patch = await h.api(`/api/v1/members/${u.id}`, {
        method: "PATCH", token: u.token, headers: { "idempotency-key": key() },
        body: { expected_revision: before!.revision, org_role: "admin", stores: [{ store_id: SEED.storeA2, role: "manager" }] },
      });
      expect(patch.status).toBe(403);
      expect(await orgMembership(u.id)).toEqual(before);
    }
  });

  it("an admin of another organization cannot see or change organization A", async () => {
    const list = await h.api(`/api/v1/members?organization_id=${SEED.orgA}`, { token: adminB.token });
    expect(list.status).toBe(404);
    const before = await orgMembership(employeeA1.id);
    const explicit = await h.api(`/api/v1/members/${employeeA1.id}`, {
      method: "PATCH", token: adminB.token, headers: { "idempotency-key": key() },
      body: { organization_id: SEED.orgA, expected_revision: before!.revision, active: false },
    });
    expect(explicit.status).toBe(404);
    // Without organization_id the request targets B, where the user is not a member.
    const implicit = await h.api(`/api/v1/members/${employeeA1.id}`, {
      method: "PATCH", token: adminB.token, headers: { "idempotency-key": key() },
      body: { expected_revision: before!.revision, active: false },
    });
    expect(implicit.status).toBe(404);
    expect(await orgMembership(employeeA1.id)).toEqual(before);
  });

  it("an admin gets the roster of their own organization only", async () => {
    const res = await h.api("/api/v1/members", { token: adminA.token });
    expect(res.status).toBe(200);
    expect(res.json.data.organization_id).toBe(SEED.orgA);
    const members = res.json.data.members.map((m: unknown) => Member.parse(m));
    const ids = members.map((m: Member) => m.user_id);
    expect(ids).toContain(employeeA1.id);
    expect(ids).not.toContain(adminB.id);
    expect(members.find((m: Member) => m.user_id === managerA1.id)?.stores).toEqual([{ store_id: SEED.storeA1, role: "manager", active: true }]);
  });
});

describe("POST /api/v1/members/invite", () => {
  it("validates the body and requires Idempotency-Key before creating anything", async () => {
    const email = `invalid-${h.run}@example.com`;
    const noKey = await h.api("/api/v1/members/invite", { method: "POST", token: adminA.token, body: { email, org_role: "member", stores: [] } });
    expect(noKey.status).toBe(422);
    expect(noKey.json.error.field_errors["Idempotency-Key"]).toBeDefined();
    const malformed = await h.api("/api/v1/members/invite", { method: "POST", token: adminA.token, headers: { "idempotency-key": key() }, body: "{oops" });
    expect(malformed.status).toBe(400);
    const smuggled = await h.api("/api/v1/members/invite", {
      method: "POST", token: adminA.token, headers: { "idempotency-key": key() },
      body: { email, org_role: "member", stores: [], actor_id: managerA1.id },
    });
    expect(smuggled.status).toBe(422);
    const crossOrgStore = await h.api("/api/v1/members/invite", {
      method: "POST", token: adminA.token, headers: { "idempotency-key": key() },
      body: { email, org_role: "member", stores: [{ store_id: SEED.storeB1, role: "employee" }] },
    });
    expect(crossOrgStore.status).toBe(422);
    expect(await authUserByEmail(email)).toEqual([]);
    expect(await mailsTo(email)).toEqual([]);
  });

  it("invites once per Idempotency-Key and the invitee signs in seeing only assigned stores", async () => {
    const email = `invitee-${h.run}@example.com`;
    const idem = key();
    const body = { email, display_name: "Invited Employee", org_role: "member", stores: [{ store_id: SEED.storeA2, role: "employee" }] };
    const first = await h.api("/api/v1/members/invite", { method: "POST", token: adminA.token, headers: { "idempotency-key": idem }, body });
    expect(first.status, first.text).toBe(201);
    const userId = first.json.data.user_id as string;

    const replay = await h.api("/api/v1/members/invite", { method: "POST", token: adminA.token, headers: { "idempotency-key": idem }, body });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.json).toEqual(first.json);

    const reused = await h.api("/api/v1/members/invite", {
      method: "POST", token: adminA.token, headers: { "idempotency-key": idem }, body: { ...body, org_role: "admin" },
    });
    expect(reused.status).toBe(409);
    expect(await authUserByEmail(email)).toHaveLength(1);

    // The email links to the allowlisted confirm page with a token hash.
    const mail = await waitForMail(email);
    const link = new URL(mail.links[0]!);
    expect(`${link.origin}${link.pathname}`).toBe(`${h.base}/auth/confirm`);
    expect(link.searchParams.get("type")).toBe("invite");
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailsTo(email)).toHaveLength(1); // the replay did not send a second email

    // Accept: confirm page → verify (session cookie) → set password.
    const confirm = await h.page(`${link.pathname}${link.search}`);
    expect(confirm.status).toBe(200);
    expect(confirm.html).toContain('action="/auth/verify"');
    const { CookieJar } = await import("../src/harness");
    const jar = new CookieJar();
    const verified = await h.form("/auth/verify", { token_hash: link.searchParams.get("token_hash")!, type: "invite" }, { jar });
    expect(verified.status).toBe(303);
    expect(verified.location).toBe(`${h.base}/account/password?from=invite`);
    const password = `Invited-${randomUUID()}`;
    const set = await h.form("/auth/set-password", { password, confirm_password: password, from: "invite" }, { jar });
    expect(set.location).toBe(`${h.base}/account/password?updated=1`);

    // iOS-style sign-in with the new password.
    const session = await h.signIn(email, password);
    const me = Me.parse((await h.api("/api/v1/me", { token: session.access_token })).json.data);
    expect(me.user_id).toBe(userId);
    expect(me.display_name).toBe("Invited Employee");
    expect(me.stores.map((s) => [s.store_id, s.role])).toEqual([[SEED.storeA2, "employee"]]);
    // On the web, an employee is sent to the iOS app.
    const home = await h.page("/", jar);
    expect(home.location).toContain("/no-access?reason=employee");

    const audit = await h.db.query("select event_type, actor_id from public.audit_events where resource_id = $1", [userId]);
    expect(audit.rows).toEqual([{ event_type: "membership.invited", actor_id: adminA.id }]);
  });

  it("refuses an email that already has an account", async () => {
    const res = await h.api("/api/v1/members/invite", {
      method: "POST", token: adminA.token, headers: { "idempotency-key": key() },
      body: { email: employeeA1.email, org_role: "admin", stores: [] },
    });
    expect(res.status).toBe(409);
    expect((await orgMembership(employeeA1.id))?.role).toBe("member");
  });
});

describe("PATCH /api/v1/members/:user_id", () => {
  it("changes stores (seen by the member's existing token), rejects stale revisions and revokes access", async () => {
    const u = await h.user("patch", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    const change = await h.api(`/api/v1/members/${u.id}`, {
      method: "PATCH", token: adminA.token, headers: { "idempotency-key": key() },
      body: { expected_revision: 1, stores: [{ store_id: SEED.storeA2, role: "manager" }] },
    });
    expect(change.status, change.text).toBe(200);
    expect(change.json.data).toEqual({ user_id: u.id, revision: 2 });
    const me = Me.parse((await h.api("/api/v1/me", { token: u.token })).json.data);
    expect(me.stores.map((s) => [s.store_id, s.role])).toEqual([[SEED.storeA2, "manager"]]);

    const stale = await h.api(`/api/v1/members/${u.id}`, {
      method: "PATCH", token: adminA.token, headers: { "idempotency-key": key() }, body: { expected_revision: 1, org_role: "admin" },
    });
    expect(stale.status).toBe(409);

    const revoke = await h.api(`/api/v1/members/${u.id}`, {
      method: "PATCH", token: adminA.token, headers: { "idempotency-key": key() }, body: { expected_revision: 2, active: false },
    });
    expect(revoke.status).toBe(200);
    expect((await h.api("/api/v1/me", { token: u.token })).status).toBe(403);
    const events = await h.db.query<{ event_type: string }>("select event_type from public.audit_events where resource_id = $1 order by created_at", [u.id]);
    expect(events.rows.map((r) => r.event_type)).toEqual(["membership.updated", "membership.revoked"]);
  });

  it("will not remove the last active admin (409) and leaves the admin unchanged", async () => {
    const org = (await h.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`Solo API ${h.run}`])).rows[0]!.id;
    const solo = await h.user("solo", { org: { id: org, role: "admin" } });
    for (const body of [{ expected_revision: 1, org_role: "member" }, { expected_revision: 1, active: false }]) {
      const res = await h.api(`/api/v1/members/${solo.id}`, { method: "PATCH", token: solo.token, headers: { "idempotency-key": key() }, body });
      expect(res.status).toBe(409);
      expect(res.json.error.message).toContain("at least one active admin");
    }
    expect(await orgMembership(solo.id, org)).toMatchObject({ role: "admin", active: true });
  });

  it("rejects malformed IDs and bodies", async () => {
    expect((await h.api("/api/v1/members/not-a-uuid", { method: "PATCH", token: adminA.token, headers: { "idempotency-key": key() }, body: { expected_revision: 1, active: false } })).status).toBe(404);
    expect((await h.api(`/api/v1/members/${employeeA1.id}`, { method: "PATCH", token: adminA.token, headers: { "idempotency-key": key() }, body: { expected_revision: 1 } })).status).toBe(422);
  });
});

describe("cookie-authenticated mutations require same origin (CSRF)", () => {
  it("rejects cross-site and Origin-less requests; accepts the app origin", async () => {
    const { jar } = await h.webSignIn(adminA);
    const target = await h.user("csrf", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    const body = { expected_revision: 1, active: false };
    for (const headers of <Record<string, string>[]>[{ origin: "http://evil.example" }, {}, { "sec-fetch-site": "cross-site" }]) {
      const res = await h.api(`/api/v1/members/${target.id}`, { method: "PATCH", jar, headers: { ...headers, "idempotency-key": key() }, body });
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect((await orgMembership(target.id))?.active).toBe(true);
    // Reads with the cookie work without Origin.
    expect((await h.api("/api/v1/me", { jar })).status).toBe(200);
    const ok = await h.api(`/api/v1/members/${target.id}`, { method: "PATCH", jar, headers: { origin: h.base, "idempotency-key": key() }, body });
    expect(ok.status, ok.text).toBe(200);
    expect((await orgMembership(target.id))?.active).toBe(false);
  });
});
