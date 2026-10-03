import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { createWorld, errorOf, type TestUser, type World } from "../src/world";

// Feature 03 membership functions. They run as service_role (the API after
// verifying the caller's token) and must re-check the actor themselves.
let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w?.close());

/** A fresh Auth identity with no memberships (what an invite creates). */
async function identity(label: string) {
  const created = await w.service.auth.admin.createUser({ email: `${label}-${w.run}-${randomUUID().slice(0, 4)}@example.com`, email_confirm: true });
  if (created.error) throw created.error;
  return created.data.user.id;
}

const membership = async (org: string, user: string) =>
  (await w.db.query<{ role: string; active: boolean; revision: number }>(
    "select role, active, revision from public.organization_memberships where organization_id = $1 and user_id = $2", [org, user],
  )).rows[0];

const activeStores = async (user: string) =>
  (await w.db.query<{ store_id: string; role: string }>(
    "select store_id, role from public.store_memberships where user_id = $1 and active order by store_id", [user],
  )).rows;

const auditFor = async (user: string) =>
  (await w.db.query<{ event_type: string; actor_id: string | null; organization_id: string; metadata: Record<string, unknown> }>(
    "select event_type, actor_id, organization_id, metadata from public.audit_events where resource_id = $1 order by created_at", [user],
  )).rows;

const invite = (actor: string, user: string, role: string, stores: unknown, org: string = SEED.orgA) =>
  w.service.rpc("apply_membership_invite", { p_actor: actor, p_org: org, p_user: user, p_org_role: role, p_stores: stores as never });

describe("client roles cannot call membership functions", () => {
  it("authenticated (even an org admin) and anon get 42501", async () => {
    const target = await identity("no-client");
    const callers = [w.anon, w.users.adminA.client, w.users.employeeA1.client];
    for (const client of callers) {
      const calls = [
        client.rpc("list_organization_members", { p_actor: w.users.adminA.id, p_org: SEED.orgA }),
        client.rpc("apply_membership_invite", { p_actor: w.users.adminA.id, p_org: SEED.orgA, p_user: target, p_org_role: "admin", p_stores: [] }),
        client.rpc("update_membership", { p_actor: w.users.adminA.id, p_org: SEED.orgA, p_user: w.users.employeeA1.id, p_expected_revision: 1, p_org_role: "admin" }),
        client.rpc("bootstrap_first_admin", { p_user: target, p_org: SEED.orgA }),
      ];
      for (const call of calls) expect((await errorOf(call))?.code).toBe("42501");
    }
    expect(await membership(SEED.orgA, target)).toBeUndefined();
    expect((await membership(SEED.orgA, w.users.employeeA1.id))?.role).toBe("member");
  });
});

describe("list_organization_members", () => {
  it("returns the organization roster with emails to an org admin", async () => {
    const { data, error } = await w.service.rpc("list_organization_members", { p_actor: w.users.adminA.id, p_org: SEED.orgA });
    expect(error).toBeNull();
    const byId = new Map(data!.map((m) => [m.user_id, m]));
    expect(byId.get(w.users.managerA1.id)?.email).toBe(w.users.managerA1.email);
    expect(byId.get(w.users.managerA1.id)?.stores).toEqual([{ store_id: SEED.storeA1, role: "manager", active: true }]);
    expect(byId.has(w.users.adminB.id)).toBe(false); // other organization
    expect(byId.has(w.users.outsider.id)).toBe(false);
  });

  it("refuses managers, employees, other organizations' admins and revoked users", async () => {
    const cases: Array<[TestUser, string]> = [
      [w.users.managerA1, "FORBIDDEN"],
      [w.users.employeeA1, "FORBIDDEN"],
      [w.users.adminB, "NOT_FOUND"],
      [w.users.revokedOrgA1, "NOT_FOUND"],
      [w.users.outsider, "NOT_FOUND"],
    ];
    for (const [actor, code] of cases) {
      const { data, error } = await w.service.rpc("list_organization_members", { p_actor: actor.id, p_org: SEED.orgA });
      expect(error?.message, actor.email).toBe(code);
      expect(data).toBeNull();
    }
  });
});

describe("apply_membership_invite", () => {
  it("creates org and store memberships atomically and audits the invite", async () => {
    const user = await identity("invitee");
    const { data, error } = await invite(w.users.adminA.id, user, "member", [{ store_id: SEED.storeA2, role: "employee" }]);
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect(await membership(SEED.orgA, user)).toMatchObject({ role: "member", active: true });
    expect(await activeStores(user)).toEqual([{ store_id: SEED.storeA2, role: "employee" }]);
    const audit = await auditFor(user);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ event_type: "membership.invited", actor_id: w.users.adminA.id, organization_id: SEED.orgA });
    expect(audit[0]!.metadata).toEqual({ after: { org_role: "member", active: true, stores: [{ store_id: SEED.storeA2, role: "employee" }] } });
  });

  it("rejects non-admin and cross-organization actors without writing anything", async () => {
    const user = await identity("invite-denied");
    expect((await invite(w.users.managerA1.id, user, "member", [{ store_id: SEED.storeA1, role: "employee" }])).error?.message).toBe("FORBIDDEN");
    expect((await invite(w.users.employeeA1.id, user, "admin", [])).error?.message).toBe("FORBIDDEN");
    expect((await invite(w.users.adminB.id, user, "member", [])).error?.message).toBe("NOT_FOUND");
    expect((await invite(w.users.revokedOrgA1.id, user, "member", [])).error?.message).toBe("NOT_FOUND");
    expect(await membership(SEED.orgA, user)).toBeUndefined();
    expect(await auditFor(user)).toEqual([]);
  });

  it("rejects stores from another organization, duplicates and bad roles, leaving no partial rows", async () => {
    const user = await identity("invite-bad-store");
    const bad: unknown[] = [
      [{ store_id: SEED.storeB1, role: "employee" }],
      [{ store_id: SEED.storeA1, role: "employee" }, { store_id: SEED.storeA1, role: "manager" }],
      [{ store_id: SEED.storeA1, role: "admin" }],
      [{ store_id: "not-a-uuid", role: "employee" }],
      { store_id: SEED.storeA1 },
    ];
    for (const stores of bad) {
      expect((await invite(w.users.adminA.id, user, "member", stores)).error?.message, JSON.stringify(stores)).toBe("VALIDATION_FAILED");
    }
    expect((await invite(w.users.adminA.id, user, "owner", [])).error?.message).toBe("VALIDATION_FAILED");
    expect(await membership(SEED.orgA, user)).toBeUndefined();
    expect(await activeStores(user)).toEqual([]);
  });

  it("refuses a user who already has a membership in the organization", async () => {
    expect((await invite(w.users.adminA.id, w.users.employeeA1.id, "admin", [])).error?.message).toBe("CONFLICT");
    expect((await membership(SEED.orgA, w.users.employeeA1.id))?.role).toBe("member");
  });
});

describe("update_membership", () => {
  const update = (actor: string, user: string, revision: number, change: { role?: string; active?: boolean; stores?: unknown }, org: string = SEED.orgA) =>
    w.service.rpc("update_membership", {
      p_actor: actor, p_org: org, p_user: user, p_expected_revision: revision,
      p_org_role: change.role, p_active: change.active, p_stores: change.stores as never,
    });

  it("replaces store assignments, bumps the revision and audits before/after", async () => {
    const u = await w.user("update-me", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    const { data, error } = await update(w.users.adminA.id, u.id, 1, { stores: [{ store_id: SEED.storeA2, role: "manager" }] });
    expect(error).toBeNull();
    expect(data).toBe(2);
    expect(await activeStores(u.id)).toEqual([{ store_id: SEED.storeA2, role: "manager" }]);
    const audit = (await auditFor(u.id)).at(-1)!;
    expect(audit.event_type).toBe("membership.updated");
    expect(audit.metadata).toEqual({
      before: { org_role: "member", active: true, stores: [{ store_id: SEED.storeA1, role: "employee" }] },
      after: { org_role: "member", active: true, stores: [{ store_id: SEED.storeA2, role: "manager" }] },
    });
    // Reassigning a previously deactivated store reactivates the same row.
    expect((await update(w.users.adminA.id, u.id, 2, { stores: [{ store_id: SEED.storeA1, role: "manager" }] })).error).toBeNull();
    expect(await activeStores(u.id)).toEqual([{ store_id: SEED.storeA1, role: "manager" }]);
  });

  it("rejects a stale revision", async () => {
    const u = await w.user("stale", { org: { id: SEED.orgA, role: "member" } });
    expect((await update(w.users.adminA.id, u.id, 1, { role: "member" })).error).toBeNull();
    expect((await update(w.users.adminA.id, u.id, 1, { role: "admin" })).error?.message).toBe("CONFLICT");
    expect((await membership(SEED.orgA, u.id))?.role).toBe("member");
  });

  it("revocation is audited as membership.revoked", async () => {
    const u = await w.user("revoke-me", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });
    expect((await update(w.users.adminA.id, u.id, 1, { active: false })).error).toBeNull();
    expect((await auditFor(u.id)).at(-1)!.event_type).toBe("membership.revoked");
    expect((await membership(SEED.orgA, u.id))?.active).toBe(false);
  });

  it("an employee or manager cannot grant themselves (or anyone) admin", async () => {
    for (const actor of [w.users.employeeA1, w.users.managerA1]) {
      const before = await membership(SEED.orgA, actor.id);
      const { error } = await update(actor.id, actor.id, before!.revision, { role: "admin", stores: [{ store_id: SEED.storeA2, role: "manager" }] });
      expect(error?.message).toBe("FORBIDDEN");
      expect(await membership(SEED.orgA, actor.id)).toEqual(before);
    }
    expect((await activeStores(w.users.employeeA1.id))).toEqual([{ store_id: SEED.storeA1, role: "employee" }]);
  });

  it("an admin of another organization gets NOT_FOUND, and so does a user outside the organization", async () => {
    expect((await update(w.users.adminB.id, w.users.employeeA1.id, 1, { active: false })).error?.message).toBe("NOT_FOUND");
    expect((await update(w.users.adminA.id, w.users.adminB.id, 1, { active: false })).error?.message).toBe("NOT_FOUND");
    expect((await membership(SEED.orgB, w.users.adminB.id))?.active).toBe(true);
  });

  it("cannot remove or demote the last active admin, including the admin themselves", async () => {
    const org = (await w.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`Solo ${w.run}`])).rows[0]!.id;
    const solo = await w.user("solo-admin", { org: { id: org, role: "admin" } });
    expect((await update(solo.id, solo.id, 1, { role: "member" }, org)).error?.message).toBe("LAST_ADMIN");
    expect((await update(solo.id, solo.id, 1, { active: false }, org)).error?.message).toBe("LAST_ADMIN");
    expect(await membership(org, solo.id)).toMatchObject({ role: "admin", active: true, revision: 1 });
  });
});

describe("last-admin guard under concurrency", () => {
  it("two admins demoting each other concurrently cannot both succeed", async () => {
    const org = (await w.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`Pair ${w.run}`])).rows[0]!.id;
    const a = await w.user("pair-a", { org: { id: org, role: "admin" } });
    const b = await w.user("pair-b", { org: { id: org, role: "admin" } });
    const c1 = new pg.Client({ connectionString: w.env.dbUrl });
    const c2 = new pg.Client({ connectionString: w.env.dbUrl });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      const demote = "update public.organization_memberships set role = 'member' where organization_id = $1 and user_id = $2";
      await c1.query("begin");
      await c2.query("begin");
      await c1.query(demote, [org, a.id]);
      // c2 waits on c1's organization lock, then re-checks with a fresh snapshot.
      const second = c2.query(demote, [org, b.id]).then(() => null, (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("commit");
      expect(await second).toBe("LAST_ADMIN");
      await c2.query("rollback");
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
    const admins = await w.db.query("select 1 from public.organization_memberships where organization_id = $1 and role = 'admin' and active", [org]);
    expect(admins.rowCount).toBe(1);
  });
});

describe("bootstrap_first_admin (operator only)", () => {
  it("creates an organization with its first admin and audits with no actor", async () => {
    const user = await identity("bootstrap");
    const { data: org, error } = await w.service.rpc("bootstrap_first_admin", { p_user: user, p_org_name: `Boot ${w.run}` });
    expect(error).toBeNull();
    expect(await membership(org!, user)).toMatchObject({ role: "admin", active: true });
    expect((await auditFor(user))[0]).toMatchObject({ event_type: "membership.bootstrapped", actor_id: null, organization_id: org });
  });

  it("refuses an organization that already has an active admin", async () => {
    const user = await identity("bootstrap-late");
    const { error } = await w.service.rpc("bootstrap_first_admin", { p_user: user, p_org: SEED.orgA });
    expect(error?.message).toBe("CONFLICT");
    expect(await membership(SEED.orgA, user)).toBeUndefined();
  });

  it("requires an existing identity and an organization name", async () => {
    expect((await w.service.rpc("bootstrap_first_admin", { p_user: randomUUID(), p_org_name: "X" })).error?.message).toBe("NOT_FOUND");
    const user = await identity("bootstrap-noname");
    expect((await w.service.rpc("bootstrap_first_admin", { p_user: user, p_org_name: "  " })).error?.message).toBe("VALIDATION_FAILED");
  });
});
