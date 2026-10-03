import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import type { Json } from "@display-refill/server";
import { createWorld, rows, type TestUser, type World } from "../src/world";

// Feature 04 management functions, called as the API calls them: with the
// service role and the verified actor. The service role bypasses RLS, so these
// tests show that each function re-checks the actor against the stored row.

// Every write happens in an organization created for this run, so the exact
// seed-set assertions in rls-reads/sessions are unaffected. Seed organizations
// A and B only appear as "another organization" in denial checks.
let w: World;
const rid = () => crypto.randomUUID();
let C: { org: string; store1: string; store2: string; product: string; version: string; draft: string };
let adminC: TestUser, managerC1: TestUser, employeeC1: TestUser;

beforeAll(async () => {
  w = await createWorld();
  const org = (await w.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`Catalog C ${w.run}`])).rows[0]!.id;
  const store = async (n: string) =>
    (await w.db.query<{ id: string }>("insert into public.stores (organization_id, name, store_number, timezone) values ($1, $2, $3, 'UTC') returning id", [org, `C Store ${n}`, `C-00${n}`])).rows[0]!.id;
  const store1 = await store("1");
  const store2 = await store("2");
  const product = (await w.db.query<{ id: string }>(
    "insert into public.products (organization_id, name, short_name, category, container_type) values ($1, 'C Salad', 'Salad', 'salad', 'bowl') returning id", [org],
  )).rows[0]!.id;
  const { pogId, versionId } = await publishedVersion(org, product, "C Mobile");
  const draft = (await w.db.query<{ id: string }>("insert into public.pog_versions (organization_id, pog_id, version_number) values ($1, $2, 2) returning id", [org, pogId])).rows[0]!.id;
  C = { org, store1, store2, product, version: versionId, draft };
  adminC = await w.user("cat-admin-c", { org: { id: org, role: "admin" } });
  managerC1 = await w.user("cat-manager-c1", { org: { id: org, role: "member" }, stores: [{ id: store1, role: "manager" }] });
  employeeC1 = await w.user("cat-employee-c1", { org: { id: org, role: "member" }, stores: [{ id: store1, role: "employee" }] });
});
afterAll(() => w?.close());

const createStore = (actor: string, org: string, name: string, number: string, timezone = "America/Los_Angeles") =>
  w.service.rpc("create_store", { p_actor: actor, p_org: org, p_name: name, p_store_number: number, p_timezone: timezone, p_request_id: rid() });
const updateStore = (actor: string, id: string, revision: number, changes: { [key: string]: Json }) =>
  w.service.rpc("update_store", { p_actor: actor, p_store_id: id, p_expected_revision: revision, p_changes: changes, p_request_id: rid() });
const createDisplay = (actor: string, store: string, name: string, version?: string) =>
  w.service.rpc("create_display", { p_actor: actor, p_store_id: store, p_name: name, ...(version ? { p_active_pog_version_id: version } : {}), p_request_id: rid() });
const updateDisplay = (actor: string, id: string, revision: number, changes: { [key: string]: Json }) =>
  w.service.rpc("update_display", { p_actor: actor, p_display_id: id, p_expected_revision: revision, p_changes: changes, p_request_id: rid() });
const createScan = (actor: string, display: string) =>
  w.service.rpc("create_scan", { p_actor: actor, p_display_id: display, p_source: "manual" });

const auditOf = async (resource: string) =>
  (await w.db.query<{ event_type: string; actor_id: string; store_id: string | null; metadata: Record<string, unknown> }>(
    // Events of one transaction share created_at; within it, ".created" was written first.
    "select event_type, actor_id, store_id, metadata from public.audit_events where resource_id = $1 order by created_at, (event_type like '%.created') desc, id", [resource],
  )).rows;

/** Synthetic published version (feature 05 will create these through the POG builder). */
async function publishedVersion(org: string, product: string, pogName = `Fixture ${w.run}`) {
  const pog = await w.db.query<{ id: string }>("insert into public.pogs (organization_id, name) values ($1, $2) returning id", [org, pogName]);
  const pogId = pog.rows[0]!.id;
  const v = await w.db.query<{ id: string }>(
    "insert into public.pog_versions (organization_id, pog_id, version_number) values ($1, $2, 1) returning id", [org, pogId],
  );
  const id = v.rows[0]!.id;
  await w.db.query(
    "update public.pog_versions set reference_path = $2, reference_width = 1600, reference_height = 1200, reference_validated_at = now() where id = $1",
    [id, `${org}/${pogId}/${id}/reference.jpg`],
  );
  await w.db.query(
    `insert into public.pog_slots (organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity)
     values ($1, $2, 'S1', $3, 0, 0, 1, 1, 4)`, [org, id, product],
  );
  await w.db.query("update public.pog_versions set state = 'published', published_at = now() where id = $1", [id]);
  return { pogId, versionId: id };
}

describe("stores", () => {
  it("an admin creates a store in their organization; the event is audited", async () => {
    const { data, error } = await createStore(adminC.id, C.org, "  Downtown  ", `D-${w.run}`);
    expect(error).toBeNull();
    expect(data).toMatchObject({ organization_id: C.org, name: "Downtown", store_number: `D-${w.run}`, active: true, revision: 1 });
    expect(await auditOf(data!.id)).toEqual([
      { event_type: "store.created", actor_id: adminC.id, store_id: data!.id,
        metadata: { after: { name: "Downtown", store_number: `D-${w.run}`, timezone: "America/Los_Angeles", active: true } } },
    ]);
  });

  it("only admins of that organization create stores; others learn nothing", async () => {
    for (const u of [managerC1, employeeC1]) {
      expect((await createStore(u.id, C.org, "Nope", `N-${w.run}`)).error?.message).toBe("FORBIDDEN");
    }
    for (const u of [w.users.adminB, w.users.outsider, w.users.revokedOrgA1]) {
      expect((await createStore(u.id, C.org, "Nope", `N-${w.run}`)).error?.message).toBe("NOT_FOUND");
    }
    expect((await w.db.query("select 1 from public.stores where store_number = $1", [`N-${w.run}`])).rowCount).toBe(0);
  });

  it("names the field for duplicate store numbers (case-insensitive), bad time zones and blank names", async () => {
    const dup = await createStore(adminC.id, C.org, "Again", "c-001");
    expect(dup.error).toMatchObject({ message: "VALIDATION_FAILED", hint: "store_number" });
    // Store numbers are unique per organization: another organization may reuse C's number.
    const orgD = (await w.db.query<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`Catalog D ${w.run}`])).rows[0]!.id;
    const adminD = await w.user("cat-admin-d", { org: { id: orgD, role: "admin" } });
    expect((await createStore(adminD.id, orgD, "D copy", "C-001")).error).toBeNull();
    expect((await createStore(adminC.id, C.org, "Mars", `M-${w.run}`, "Mars/Olympus")).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "timezone" });
    expect((await createStore(adminC.id, C.org, "   ", `M-${w.run}`)).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "name" });
  });

  it("updates with a revision check, archives and restores, and skips no-op changes", async () => {
    const { data: s } = await createStore(adminC.id, C.org, "Revision", `R-${w.run}`);
    const renamed = await updateStore(adminC.id, s!.id, 1, { name: "Revision 2" });
    expect(renamed.data).toMatchObject({ name: "Revision 2", revision: 2 });
    const stale = await updateStore(adminC.id, s!.id, 1, { name: "Lost update" });
    expect(stale.error?.message).toBe("CONFLICT");
    const same = await updateStore(adminC.id, s!.id, 2, { name: "Revision 2" });
    expect(same.data?.revision).toBe(2);
    expect((await updateStore(adminC.id, s!.id, 2, { active: false })).data).toMatchObject({ active: false, revision: 3 });
    expect((await updateStore(adminC.id, s!.id, 3, { active: true })).data).toMatchObject({ active: true, revision: 4 });
    expect((await auditOf(s!.id)).map((e) => e.event_type)).toEqual(["store.created", "store.updated", "store.archived", "store.restored"]);
  });

  it("refuses non-admins, other organizations, unknown fields and renumbering onto an existing number", async () => {
    const { data: s } = await createStore(adminC.id, C.org, "Guarded", `G-${w.run}`);
    expect((await updateStore(w.users.adminB.id, s!.id, 1, { active: false })).error?.message).toBe("NOT_FOUND");
    expect((await updateStore(employeeC1.id, s!.id, 1, { active: false })).error?.message).toBe("NOT_FOUND");
    // A manager who can see a store still cannot change it.
    expect((await updateStore(managerC1.id, C.store1, 1, { name: "Mine now" })).error?.message).toBe("FORBIDDEN");
    expect((await updateStore(adminC.id, s!.id, 1, { organization_id: SEED.orgB })).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "request" });
    expect((await updateStore(adminC.id, s!.id, 1, { store_number: "C-002" })).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "store_number" });
    expect((await w.db.query("select revision, organization_id from public.stores where id = $1", [s!.id])).rows).toEqual([{ revision: 1, organization_id: C.org }]);
  });
});

describe("products and POG identities", () => {
  const createProduct = (actor: string, org: string, extra: Record<string, unknown> = {}) =>
    w.service.rpc("create_product", {
      p_actor: actor, p_org: org, p_name: "Fruit Bowl", p_short_name: "Fruit", p_category: "fruit", p_container_type: "bowl", p_request_id: rid(), ...extra,
    });

  it("admins create and edit products; codes are optional and validated; others are refused", async () => {
    const { data: p, error } = await createProduct(adminC.id, C.org, { p_sku: " SKU-1 ", p_upc: "012345678905" });
    expect(error).toBeNull();
    expect(p).toMatchObject({ sku: "SKU-1", plu: null, upc: "012345678905", active: true });
    expect((await createProduct(adminC.id, C.org, { p_upc: "12AB" })).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "upc" });
    expect((await createProduct(managerC1.id, C.org)).error?.message).toBe("FORBIDDEN");
    expect((await createProduct(w.users.adminB.id, C.org)).error?.message).toBe("NOT_FOUND");

    const update = (actor: string, revision: number, changes: { [key: string]: Json }) =>
      w.service.rpc("update_product", { p_actor: actor, p_product_id: p!.id, p_expected_revision: revision, p_changes: changes, p_request_id: rid() });
    expect((await update(adminC.id, 1, { sku: null, active: false })).data).toMatchObject({ sku: null, active: false, revision: 2 });
    expect((await update(adminC.id, 1, { name: "Stale" })).error?.message).toBe("CONFLICT");
    expect((await update(managerC1.id, 2, { name: "Manager" })).error?.message).toBe("FORBIDDEN");
    expect((await update(w.users.adminB.id, 2, { name: "Other org" })).error?.message).toBe("NOT_FOUND");
    expect((await auditOf(p!.id)).map((e) => e.event_type)).toEqual(["product.created", "product.archived"]);
  });

  it("renaming a product through update_product leaves existing scan snapshots unchanged", async () => {
    const { data: p } = await createProduct(adminC.id, C.org);
    const { versionId } = await publishedVersion(C.org, p!.id);
    const { data: d } = await createDisplay(managerC1.id, C.store1, `Snapshot ${w.run}`, versionId);
    const scan = await createScan(employeeC1.id, d!.id);
    expect(scan.error).toBeNull();
    const renamed = await w.service.rpc("update_product", {
      p_actor: adminC.id, p_product_id: p!.id, p_expected_revision: 1, p_changes: { name: "Fruit Bowl XL" }, p_request_id: rid(),
    });
    expect(renamed.data?.name).toBe("Fruit Bowl XL");
    const slots = await rows<{ product_name_snapshot: string }>(w.service.from("scan_slots").select("product_name_snapshot").eq("scan_id", scan.data![0]!.scan_id));
    expect(slots).toEqual([{ product_name_snapshot: "Fruit Bowl" }]);
  });

  it("create_pog makes the identity plus an empty draft version 1 created by the actor", async () => {
    const { data: g, error } = await w.service.rpc("create_pog", { p_actor: adminC.id, p_org: C.org, p_name: "End cap", p_request_id: rid() });
    expect(error).toBeNull();
    const versions = await rows(w.service.from("pog_versions").select("version_number, state, created_by, reference_path").eq("pog_id", g!.id));
    expect(versions).toEqual([{ version_number: 1, state: "draft", created_by: adminC.id, reference_path: null }]);
    expect((await w.service.rpc("create_pog", { p_actor: managerC1.id, p_org: C.org, p_name: "No" })).error?.message).toBe("FORBIDDEN");
    const archived = await w.service.rpc("update_pog", { p_actor: adminC.id, p_pog_id: g!.id, p_expected_revision: 1, p_changes: { archived: true } });
    expect(archived.data).toMatchObject({ archived: true, revision: 2 });
    expect((await auditOf(g!.id)).map((e) => e.event_type)).toEqual(["pog.created", "pog.archived"]);
  });
});

describe("displays", () => {
  it("a manager creates and edits displays only in an assigned store", async () => {
    const created = await createDisplay(managerC1.id, C.store1, `Deli ${w.run}`, C.version);
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({ organization_id: C.org, store_id: C.store1, active_pog_version_id: C.version });
    expect((await auditOf(created.data!.id)).map((e) => [e.event_type, e.store_id])).toEqual([["display.created", C.store1], ["display.assigned", C.store1]]);

    // Store C2 (same organization) is not the manager's store; neither is another organization's.
    const other = await createDisplay(adminC.id, C.store2, `Other store ${w.run}`);
    expect((await createDisplay(managerC1.id, C.store2, "Elsewhere")).error?.message).toBe("NOT_FOUND");
    expect((await updateDisplay(managerC1.id, other.data!.id, 1, { name: "Hijack" })).error?.message).toBe("NOT_FOUND");
    expect((await updateDisplay(managerC1.id, SEED.displayA2, 1, { name: "Hijack" })).error?.message).toBe("NOT_FOUND");
    // Employees: no management.
    expect((await createDisplay(employeeC1.id, C.store1, "Employee")).error?.message).toBe("FORBIDDEN");
    expect((await updateDisplay(employeeC1.id, created.data!.id, 1, { active: false })).error?.message).toBe("FORBIDDEN");
    expect((await createDisplay(w.users.adminB.id, C.store1, "Org B")).error?.message).toBe("NOT_FOUND");
    expect((await updateDisplay(w.users.adminB.id, created.data!.id, 1, { active: false })).error?.message).toBe("NOT_FOUND");
    expect((await w.db.query("select name, revision from public.displays where id = any($1) order by name", [[SEED.displayA2, other.data!.id]])).rows).toEqual([
      { name: "A2 Mobile 2", revision: 1 },
      { name: `Other store ${w.run}`, revision: 1 },
    ]);
  });

  it("assigns only published versions of an active POG in the display's organization", async () => {
    const { data: d } = await createDisplay(adminC.id, C.store1, `Assign ${w.run}`);
    const fail = async (version: string) => (await updateDisplay(adminC.id, d!.id, 1, { active_pog_version_id: version })).error;
    // Cross-organization, draft, unknown and archived-POG versions are all rejected the same way.
    for (const version of [SEED.versionA1, SEED.versionB1, C.draft, crypto.randomUUID()]) {
      expect(await fail(version)).toMatchObject({ message: "VALIDATION_FAILED", hint: "active_pog_version_id" });
    }
    const archived = await publishedVersion(C.org, C.product, `Archived ${w.run}`);
    await w.db.query("update public.pogs set archived = true where id = $1", [archived.pogId]);
    expect(await fail(archived.versionId)).toMatchObject({ message: "VALIDATION_FAILED", hint: "active_pog_version_id" });
    expect((await createDisplay(w.users.adminB.id, SEED.storeB1, "B gets A", C.version)).error).toMatchObject({ hint: "active_pog_version_id" });
    expect((await w.db.query("select active_pog_version_id, revision from public.displays where id = $1", [d!.id])).rows[0]).toEqual({ active_pog_version_id: null, revision: 1 });

    const assigned = await updateDisplay(adminC.id, d!.id, 1, { active_pog_version_id: C.version });
    expect(assigned.data).toMatchObject({ active_pog_version_id: C.version, revision: 2 });
    const unassigned = await updateDisplay(adminC.id, d!.id, 2, { active_pog_version_id: null });
    expect(unassigned.data).toMatchObject({ active_pog_version_id: null, revision: 3 });
    expect((await auditOf(d!.id)).map((e) => [e.event_type, e.metadata])).toEqual([
      ["display.created", { name: `Assign ${w.run}`, active_pog_version_id: null }],
      ["display.assigned", { before: null, after: C.version }],
      ["display.assigned", { before: C.version, after: null }],
    ]);
  });

  it("archiving a display blocks new scans and keeps earlier scans intact", async () => {
    const { data: d } = await createDisplay(managerC1.id, C.store1, `Archive ${w.run}`, C.version);
    const before = await createScan(employeeC1.id, d!.id);
    expect(before.error).toBeNull();
    const scanId = before.data![0]!.scan_id;
    expect((await updateDisplay(managerC1.id, d!.id, 1, { active: false })).data).toMatchObject({ active: false, revision: 2 });
    expect((await createScan(employeeC1.id, d!.id)).error?.message).toBe("VALIDATION_FAILED");
    // The employee still reads the earlier scan and its slots through RLS.
    const scans = await rows(employeeC1.client.from("scans").select("id, display_id, pog_version_id").eq("id", scanId));
    expect(scans).toEqual([{ id: scanId, display_id: d!.id, pog_version_id: C.version }]);
    expect(await rows(employeeC1.client.from("scan_slots").select("id").eq("scan_id", scanId))).toHaveLength(1);
    expect((await auditOf(d!.id)).map((e) => e.event_type)).toContain("display.archived");
  });

  it("an archived store blocks new displays, display restores and scans", async () => {
    const { data: s } = await createStore(adminC.id, C.org, "Closing", `C-${w.run}`);
    const { data: d } = await createDisplay(adminC.id, s!.id, "Closing case", C.version);
    await updateDisplay(adminC.id, d!.id, 1, { active: false });
    await updateStore(adminC.id, s!.id, 1, { active: false });
    expect((await createDisplay(adminC.id, s!.id, "Late")).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "store_id" });
    expect((await updateDisplay(adminC.id, d!.id, 2, { active: true })).error).toMatchObject({ message: "VALIDATION_FAILED", hint: "active" });
    // Store archived while its display stays active: scans still blocked.
    const { data: s2 } = await createStore(adminC.id, C.org, "Closing 2", `C2-${w.run}`);
    const { data: d2 } = await createDisplay(adminC.id, s2!.id, "Open case", C.version);
    expect((await createScan(adminC.id, d2!.id)).error).toBeNull();
    await updateStore(adminC.id, s2!.id, 1, { active: false });
    expect((await createScan(adminC.id, d2!.id)).error?.message).toBe("VALIDATION_FAILED");
  });

  it("client roles cannot call the management functions", async () => {
    const { error } = await adminC.client.rpc("create_store", {
      p_actor: adminC.id, p_org: C.org, p_name: "Direct", p_store_number: `X-${w.run}`, p_timezone: "UTC",
    });
    expect(error?.code).toBe("42501");
    const direct = await managerC1.client.rpc("update_display", { p_actor: managerC1.id, p_display_id: SEED.displayA1, p_expected_revision: 1, p_changes: { active: false } });
    expect(direct.error?.code).toBe("42501");
  });
});

describe("concurrency", () => {
  let c1: pg.Client;
  let c2: pg.Client;
  beforeAll(async () => {
    c1 = new pg.Client({ connectionString: w.env.dbUrl });
    c2 = new pg.Client({ connectionString: w.env.dbUrl });
    await Promise.all([c1.connect(), c2.connect()]);
  });
  afterAll(async () => {
    await Promise.all([c1?.end(), c2?.end()]);
  });
  const settle = (query: Promise<unknown>) => query.then(() => null, (e: Error) => e.message);
  const updateSql = "select revision from public.update_display($1, $2, $3, $4::jsonb)";

  it("two edits with the same expected revision: the second gets CONFLICT, not a silent overwrite", async () => {
    const { data: d } = await createDisplay(managerC1.id, C.store1, `Race ${w.run}`);
    await c1.query("begin");
    await c1.query(updateSql, [managerC1.id, d!.id, 1, JSON.stringify({ name: "First" })]);
    const second = settle(c2.query(updateSql, [adminC.id, d!.id, 1, JSON.stringify({ name: "Second" })]));
    await sleep(300); // c2 is now waiting for c1's row lock
    await c1.query("commit");
    expect(await second).toBe("CONFLICT");
    expect((await w.db.query("select name, revision from public.displays where id = $1", [d!.id])).rows[0]).toEqual({ name: "First", revision: 2 });
  });

  it("an archive waits for an in-flight scan creation; the next scan is refused", async () => {
    const { data: d } = await createDisplay(managerC1.id, C.store1, `Scan race ${w.run}`, C.version);
    await c1.query("begin");
    await c1.query("select scan_id from public.create_scan($1, $2, 'manual')", [employeeC1.id, d!.id]);
    let archived = false;
    const archive = c2.query(updateSql, [managerC1.id, d!.id, 1, JSON.stringify({ active: false })]).then(() => { archived = true; });
    await sleep(300);
    expect(archived).toBe(false); // blocked by the scan's FOR SHARE lock on the display
    await c1.query("commit");
    await archive;
    expect((await w.db.query("select count(*)::int as n from public.scans where display_id = $1", [d!.id])).rows[0]).toEqual({ n: 1 });
    expect((await createScan(employeeC1.id, d!.id)).error?.message).toBe("VALIDATION_FAILED");
  });
});
