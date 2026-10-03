import { randomUUID } from "node:crypto";
import { Display, DisplayDetail, organizationPage, page, Pog, Product, Store } from "@display-refill/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiUser, createHarness, type Harness, SEED } from "../src/harness";

// Feature 04 over HTTP: store/product/POG/display management with bearer
// tokens (as iOS or any API client would call it) and the web session cookie.

let h: Harness;
let adminC: ApiUser, managerC1: ApiUser, employeeC1: ApiUser, adminB: ApiUser, managerB1: ApiUser;

const key = () => randomUUID();
const post = (path: string, token: string, body: unknown, idem = key()) => h.api(path, { method: "POST", token, headers: { "idempotency-key": idem }, body });
const patch = (path: string, token: string, body: unknown, idem = key()) => h.api(path, { method: "PATCH", token, headers: { "idempotency-key": idem }, body });
const createScan = (actor: string, display: string) => h.service.rpc("create_scan", { p_actor: actor, p_display_id: display, p_source: "manual" });
const row = async <T>(sql: string, params: unknown[]) => (await h.db.query(sql, params)).rows[0] as T;

/** Synthetic published version until the feature 05 POG builder exists. */
async function publishedVersion(org: string, product: string, name = `API fixture ${h.run}`) {
  const pog = await row<{ id: string }>("insert into public.pogs (organization_id, name) values ($1, $2) returning id", [org, name]);
  const v = await row<{ id: string }>("insert into public.pog_versions (organization_id, pog_id, version_number) values ($1, $2, 1) returning id", [org, pog.id]);
  await h.db.query("update public.pog_versions set reference_path = $2, reference_width = 1600, reference_height = 1200, reference_validated_at = now() where id = $1", [v.id, `${org}/${pog.id}/${v.id}/reference.jpg`]);
  await h.db.query(
    `insert into public.pog_slots (organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity) values ($1, $2, 'S1', $3, 0, 0, 1, 1, 4)`,
    [org, v.id, product],
  );
  await h.db.query("update public.pog_versions set state = 'published', published_at = now() where id = $1", [v.id]);
  return { pogId: pog.id, versionId: v.id };
}

// All writes happen in an organization created for this run, so other suites'
// exact seed-set assertions (and reruns without a reset) are unaffected. Seed
// organizations A and B appear only as "another organization" in denials.
let C: {
  org: string; store1: string; store2: string; product: string; draftProduct: string;
  pog: string; version: string; draft: string; display1: string; display2: string;
};

beforeAll(async () => {
  h = await createHarness();
  const org = (await row<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`API catalog C ${h.run}`])).id;
  const store = async (n: string) =>
    (await row<{ id: string }>("insert into public.stores (organization_id, name, store_number, timezone) values ($1, $2, $3, 'UTC') returning id", [org, `C Store ${n}`, `C-00${n}`])).id;
  const product = async (name: string) =>
    (await row<{ id: string }>("insert into public.products (organization_id, name, short_name, category, container_type) values ($1, $2, $2, 'salad', 'bowl') returning id", [org, name])).id;
  const store1 = await store("1");
  const store2 = await store("2");
  const layoutProduct = await product("C Salad");
  const draftProduct = await product("C Draft-only Wrap");
  const { pogId, versionId } = await publishedVersion(org, layoutProduct, "C Mobile");
  const draft = (await row<{ id: string }>("insert into public.pog_versions (organization_id, pog_id, version_number) values ($1, $2, 2) returning id", [org, pogId])).id;
  await h.db.query(
    "insert into public.pog_slots (organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity) values ($1, $2, 'D1', $3, 0, 0, 1, 1, 2)",
    [org, draft, draftProduct],
  );
  const display = async (storeId: string, name: string) =>
    (await row<{ id: string }>("insert into public.displays (organization_id, store_id, name, active_pog_version_id) values ($1, $2, $3, $4) returning id", [org, storeId, name, versionId])).id;
  C = {
    org, store1, store2, product: layoutProduct, draftProduct, pog: pogId, version: versionId, draft,
    display1: await display(store1, "C1 case"), display2: await display(store2, "C2 case"),
  };
  adminC = await h.user("c-admin-c", { org: { id: org, role: "admin" } });
  managerC1 = await h.user("c-manager-c1", { org: { id: org, role: "member" }, stores: [{ id: store1, role: "manager" }] });
  employeeC1 = await h.user("c-employee-c1", { org: { id: org, role: "member" }, stores: [{ id: store1, role: "employee" }] });
  adminB = await h.user("c-admin-b", { org: { id: SEED.orgB, role: "admin" } });
  managerB1 = await h.user("c-manager-b1", { org: { id: SEED.orgB, role: "member" }, stores: [{ id: SEED.storeB1, role: "manager" }] });
});
afterAll(() => h?.close());

describe("admin configures stores and products", () => {
  it("creates two stores and sample products, which the lists then return", async () => {
    const stores = [];
    for (const [name, number, tz] of [["North", `N-${h.run}`, "America/Chicago"], ["South", `S-${h.run}`, "America/Denver"]] as const) {
      const res = await post("/api/v1/stores", adminC.token, { name, store_number: number, timezone: tz });
      expect(res.status, res.text).toBe(201);
      stores.push(Store.parse(res.json.data));
    }
    expect(stores.map((s) => [s.organization_id, s.active, s.revision])).toEqual([[C.org, true, 1], [C.org, true, 1]]);

    const products = [];
    for (const body of [
      { name: `Chef Salad ${h.run}`, short_name: "Chef", category: "salad", container_type: "clamshell", sku: "CHEF-1" },
      { name: `Fruit Cup ${h.run}`, short_name: "Fruit", category: "fruit", container_type: "cup", upc: "012345678905" },
      { name: `Parfait ${h.run}`, short_name: "Parfait", category: "dessert", container_type: "cup", plu: "4011" },
    ]) {
      const res = await post("/api/v1/products", adminC.token, body);
      expect(res.status, res.text).toBe(201);
      products.push(Product.parse(res.json.data));
    }

    const storeList = await h.api("/api/v1/stores?limit=100", { token: adminC.token });
    expect(storeList.status).toBe(200);
    const listed = page(Store).parse(storeList.json.data).items.map((s) => s.store_id);
    for (const s of stores) expect(listed).toContain(s.store_id);
    expect(listed).not.toContain(SEED.storeB1);

    const productList = organizationPage(Product).parse((await h.api("/api/v1/products?limit=100", { token: adminC.token })).json.data);
    for (const p of products) expect(productList.items.map((x) => x.product_id)).toContain(p.product_id);
    expect(productList.items.every((p) => p.organization_id === C.org)).toBe(true);

    // Managers read the organization catalog; employees only what their layouts use.
    const managerProducts = organizationPage(Product).parse((await h.api("/api/v1/products?limit=100", { token: managerC1.token })).json.data).items;
    expect(managerProducts.map((p) => p.product_id)).toContain(products[0]!.product_id);
    const employeeProducts = organizationPage(Product).parse((await h.api("/api/v1/products?limit=100", { token: employeeC1.token })).json.data).items;
    const employeeIds = employeeProducts.map((p) => p.product_id);
    expect(employeeIds).toEqual(expect.arrayContaining([C.product]));
    expect(employeeIds).not.toContain(products[0]!.product_id); // in the catalog, but in no layout of their store
    expect(employeeIds).not.toContain(C.draftProduct);

    const audit = await h.db.query("select event_type from public.audit_events where actor_id = $1 order by created_at", [adminC.id]);
    expect(audit.rows.map((r) => r.event_type)).toEqual(["store.created", "store.created", "product.created", "product.created", "product.created"]);
  });

  it("reports required fields, duplicate store numbers and bad time zones per field", async () => {
    const missing = await post("/api/v1/stores", adminC.token, { name: "  ", timezone: "" });
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.json.error.field_errors).sort()).toEqual(["name", "store_number", "timezone"]);

    const dup = await post("/api/v1/stores", adminC.token, { name: "Duplicate", store_number: "c-001", timezone: "UTC" });
    expect(dup.status).toBe(422);
    expect(dup.json.error.field_errors).toEqual({ store_number: ["is already used by another store in this organization"] });

    const tz = await post("/api/v1/stores", adminC.token, { name: "Nowhere", store_number: `TZ-${h.run}`, timezone: "Mars/Olympus_Mons" });
    expect(tz.status).toBe(422);
    expect(tz.json.error.field_errors.timezone).toBeDefined();

    const product = await post("/api/v1/products", adminC.token, { name: "X", short_name: "", category: "c", container_type: "cup", upc: "12-34" });
    expect(product.status).toBe(422);
    expect(Object.keys(product.json.error.field_errors).sort()).toEqual(["short_name", "upc"]);

    // Fields a client may not set are rejected, not ignored.
    const smuggled = await post("/api/v1/stores", adminC.token, { name: "Smuggled", store_number: `SM-${h.run}`, timezone: "UTC", active: false, actor_id: managerC1.id });
    expect(smuggled.status).toBe(422);
    expect((await h.db.query("select 1 from public.stores where store_number = any($1)", [[`TZ-${h.run}`, `SM-${h.run}`]])).rowCount).toBe(0);
  });

  it("requires Idempotency-Key; replays the same request and refuses a changed body", async () => {
    const body = { name: "Idempotent", store_number: `I-${h.run}`, timezone: "UTC" };
    expect((await h.api("/api/v1/stores", { method: "POST", token: adminC.token, body })).status).toBe(422);
    const idem = key();
    const first = await post("/api/v1/stores", adminC.token, body, idem);
    expect(first.status).toBe(201);
    const again = await post("/api/v1/stores", adminC.token, body, idem);
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.json).toEqual(first.json);
    expect((await post("/api/v1/stores", adminC.token, { ...body, name: "Changed" }, idem)).status).toBe(409);
    expect((await h.db.query("select 1 from public.stores where store_number = $1", [`I-${h.run}`])).rowCount).toBe(1);
  });

  it("creates a POG identity with an empty draft version 1; managers see published versions only", async () => {
    const res = await post("/api/v1/pogs", adminC.token, { name: `Endcap ${h.run}` });
    expect(res.status, res.text).toBe(201);
    const pog = Pog.parse(res.json.data);
    expect(pog.versions).toEqual([expect.objectContaining({ version_number: 1, state: "draft", published_at: null, slot_count: 0 })]);

    const adminView = organizationPage(Pog).parse((await h.api("/api/v1/pogs?limit=100", { token: adminC.token })).json.data).items;
    expect(adminView.find((p) => p.pog_id === C.pog)?.versions.map((v) => v.state)).toEqual(["draft", "published"]);
    const managerView = organizationPage(Pog).parse((await h.api("/api/v1/pogs?limit=100", { token: managerC1.token })).json.data).items;
    expect(managerView.find((p) => p.pog_id === C.pog)?.versions.map((v) => v.state)).toEqual(["published"]);
    expect(managerView.find((p) => p.pog_id === pog.pog_id)?.versions).toEqual([]);
  });
});

describe("catalog changes are admin-only and organization-scoped", () => {
  it("managers and employees cannot create or change stores, products or POGs", async () => {
    for (const u of [managerC1, employeeC1]) {
      expect((await post("/api/v1/stores", u.token, { name: "No", store_number: `NO-${h.run}`, timezone: "UTC" })).status).toBe(403);
      expect((await post("/api/v1/products", u.token, { name: "No", short_name: "No", category: "c", container_type: "cup" })).status).toBe(403);
      expect((await post("/api/v1/pogs", u.token, { name: "No" })).status).toBe(403);
      expect((await patch(`/api/v1/stores/${C.store1}`, u.token, { expected_revision: 1, name: "Taken over" })).status).toBe(403);
      expect((await patch(`/api/v1/products/${C.product}`, u.token, { expected_revision: 1, name: "Renamed" })).status).toBe(403);
      expect((await patch(`/api/v1/pogs/${C.pog}`, u.token, { expected_revision: 1, archived: true })).status).toBe(403);
    }
    expect(await row("select name from public.stores where id = $1", [C.store1])).toEqual({ name: "C Store 1" });
  });

  it("another organization's admin gets 404 for organization A's records, explicit or implied", async () => {
    expect((await post("/api/v1/stores", adminB.token, { organization_id: C.org, name: "B in A", store_number: `BA-${h.run}`, timezone: "UTC" })).status).toBe(404);
    expect((await post("/api/v1/products", adminB.token, { organization_id: C.org, name: "B", short_name: "B", category: "c", container_type: "cup" })).status).toBe(404);
    for (const [path, body] of [
      [`/api/v1/stores/${C.store1}`, { expected_revision: 1, active: false }],
      [`/api/v1/products/${C.product}`, { expected_revision: 1, active: false }],
      [`/api/v1/pogs/${C.pog}`, { expected_revision: 1, archived: true }],
      [`/api/v1/displays/${C.display1}`, { expected_revision: 1, active: false }],
    ] as const) {
      const res = await patch(path, adminB.token, body);
      expect(res.status, path).toBe(404);
    }
    expect((await post(`/api/v1/stores/${C.store1}/displays`, adminB.token, { name: "B display" })).status).toBe(404);
    expect((await h.api(`/api/v1/stores/${C.store1}/displays`, { token: adminB.token })).status).toBe(404);
    expect((await h.api(`/api/v1/displays/${C.display1}`, { token: adminB.token })).status).toBe(404);
    expect((await h.api(`/api/v1/products?organization_id=${C.org}`, { token: adminB.token })).status).toBe(404);
    expect(await row("select active, revision from public.displays where id = $1", [C.display1])).toEqual({ active: true, revision: 1 });
  });
});

describe("display management", () => {
  it("a manager creates, renames, assigns and archives displays in an assigned store only", async () => {
    const created = await post(`/api/v1/stores/${C.store1}/displays`, managerC1.token, { name: `Deli ${h.run}`, active_pog_version_id: C.version });
    expect(created.status, created.text).toBe(201);
    const d = Display.parse(created.json.data);
    expect(d).toMatchObject({ store_id: C.store1, active: true, revision: 1, latest_scan_at: null, has_archived_products: false });
    expect(d.active_pog).toMatchObject({ pog_id: C.pog, pog_version_id: C.version, version_number: 1, pog_name: "C Mobile" });

    const renamed = await patch(`/api/v1/displays/${d.display_id}`, managerC1.token, { expected_revision: 1, name: `Deli 2 ${h.run}` });
    expect(renamed.status).toBe(200);
    expect(Display.parse(renamed.json.data)).toMatchObject({ name: `Deli 2 ${h.run}`, revision: 2 });
    const unassigned = await patch(`/api/v1/displays/${d.display_id}`, managerC1.token, { expected_revision: 2, active_pog_version_id: null });
    expect(Display.parse(unassigned.json.data).active_pog).toBeNull();
    // An unassigned display blocks new scans.
    expect((await createScan(employeeC1.id, d.display_id)).error?.message).toBe("POG_NOT_ASSIGNED");

    // Store A2 is not the manager's: listing, creating and editing all look like "not found".
    expect((await h.api(`/api/v1/stores/${C.store2}/displays`, { token: managerC1.token })).status).toBe(404);
    expect((await post(`/api/v1/stores/${C.store2}/displays`, managerC1.token, { name: "Elsewhere" })).status).toBe(404);
    expect((await patch(`/api/v1/displays/${C.display2}`, managerC1.token, { expected_revision: 1, name: "Hijacked" })).status).toBe(404);
    expect((await h.api(`/api/v1/displays/${C.display2}`, { token: managerC1.token })).status).toBe(404);
    // Employees of the store can read but not manage.
    expect((await h.api(`/api/v1/stores/${C.store1}/displays`, { token: employeeC1.token })).status).toBe(200);
    expect((await post(`/api/v1/stores/${C.store1}/displays`, employeeC1.token, { name: "Employee" })).status).toBe(403);
    expect((await patch(`/api/v1/displays/${d.display_id}`, employeeC1.token, { expected_revision: 3, active: false })).status).toBe(403);
    expect(await row("select name from public.displays where id = $1", [C.display2])).toEqual({ name: "C2 case" });

    // Admins act organization-wide.
    const byAdmin = await post(`/api/v1/stores/${C.store2}/displays`, adminC.token, { name: `Admin case ${h.run}` });
    expect(byAdmin.status).toBe(201);
  });

  it("cross-organization, draft and unknown POG assignments are rejected server-side", async () => {
    const d = Display.parse((await post(`/api/v1/stores/${C.store1}/displays`, managerC1.token, { name: `Assign ${h.run}` })).json.data);
    for (const version of [SEED.versionA1, SEED.versionB1, C.draft, randomUUID()]) {
      const res = await patch(`/api/v1/displays/${d.display_id}`, adminC.token, { expected_revision: 1, active_pog_version_id: version });
      expect(res.status, version).toBe(422);
      expect(res.json.error.field_errors).toEqual({ active_pog_version_id: ["choose a published version of an active POG in this organization"] });
    }
    // The other direction too: organization B's manager cannot assign A's version.
    const fromB = await post(`/api/v1/stores/${SEED.storeB1}/displays`, managerB1.token, { name: "B wants A", active_pog_version_id: C.version });
    expect(fromB.status).toBe(422);
    expect(await row("select active_pog_version_id, revision from public.displays where id = $1", [d.display_id])).toEqual({ active_pog_version_id: null, revision: 1 });
    expect((await h.db.query("select 1 from public.displays where name = 'B wants A'", [])).rowCount).toBe(0);
  });

  it("concurrent edits: the stale one gets 409 and nothing is silently overwritten", async () => {
    const d = Display.parse((await post(`/api/v1/stores/${C.store1}/displays`, managerC1.token, { name: `Shared ${h.run}` })).json.data);
    const [a, b] = await Promise.all([
      patch(`/api/v1/displays/${d.display_id}`, managerC1.token, { expected_revision: 1, name: "From manager" }),
      patch(`/api/v1/displays/${d.display_id}`, adminC.token, { expected_revision: 1, name: "From admin" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? "From manager" : "From admin";
    const loser = a.status === 409 ? a : b;
    expect(loser.json.error.code).toBe("CONFLICT");
    expect(await row("select name, revision from public.displays where id = $1", [d.display_id])).toEqual({ name: winner, revision: 2 });

    // Same for stores and products.
    const s = Store.parse((await post("/api/v1/stores", adminC.token, { name: "Race", store_number: `RC-${h.run}`, timezone: "UTC" })).json.data);
    expect((await patch(`/api/v1/stores/${s.store_id}`, adminC.token, { expected_revision: 1, name: "Race 2" })).status).toBe(200);
    expect((await patch(`/api/v1/stores/${s.store_id}`, adminC.token, { expected_revision: 1, name: "Race lost" })).status).toBe(409);
    const p = Product.parse((await post("/api/v1/products", adminC.token, { name: "Race", short_name: "Race", category: "c", container_type: "cup" })).json.data);
    expect((await patch(`/api/v1/products/${p.product_id}`, adminC.token, { expected_revision: 1, category: "x" })).status).toBe(200);
    expect((await patch(`/api/v1/products/${p.product_id}`, adminC.token, { expected_revision: 1, category: "y" })).status).toBe(409);
    expect(await row("select category from public.products where id = $1", [p.product_id])).toEqual({ category: "x" });
  });
});

describe("history is preserved", () => {
  it("archiving a display blocks new scans; the earlier scan and its detail remain", async () => {
    const d = Display.parse((await post(`/api/v1/stores/${C.store1}/displays`, managerC1.token, { name: `To archive ${h.run}`, active_pog_version_id: C.version })).json.data);
    const scan = await createScan(employeeC1.id, d.display_id);
    expect(scan.error).toBeNull();
    const listed = page(Display).parse((await h.api(`/api/v1/stores/${C.store1}/displays?limit=100`, { token: managerC1.token })).json.data).items;
    expect(listed.find((x) => x.display_id === d.display_id)?.latest_scan_at).not.toBeNull();

    const archived = await patch(`/api/v1/displays/${d.display_id}`, managerC1.token, { expected_revision: 1, active: false });
    expect(archived.status).toBe(200);
    expect((await createScan(employeeC1.id, d.display_id)).error?.message).toBe("VALIDATION_FAILED");

    // Not deleted: detail still readable; archived only listed for managers.
    const detail = DisplayDetail.parse((await h.api(`/api/v1/displays/${d.display_id}`, { token: managerC1.token })).json.data);
    expect(detail.display.active).toBe(false);
    expect(detail.slots.map((s) => s.label)).toEqual(["S1"]);
    const archivedList = page(Display).parse((await h.api(`/api/v1/stores/${C.store1}/displays?status=archived&limit=100`, { token: managerC1.token })).json.data).items;
    expect(archivedList.map((x) => x.display_id)).toContain(d.display_id);
    expect((await h.api(`/api/v1/stores/${C.store1}/displays?status=archived`, { token: employeeC1.token })).status).toBe(403);
    const scanId = scan.data![0]!.scan_id;
    expect(await row("select status, display_id from public.scans where id = $1", [scanId])).toEqual({ status: "needs_review", display_id: d.display_id });
    expect((await h.db.query("select 1 from public.scan_slots where scan_id = $1", [scanId])).rowCount).toBe(1);
  });

  it("archiving a store blocks new scans in it and it moves to the archived list", async () => {
    const s = Store.parse((await post("/api/v1/stores", adminC.token, { name: "Closing", store_number: `CL-${h.run}`, timezone: "UTC" })).json.data);
    const d = Display.parse((await post(`/api/v1/stores/${s.store_id}/displays`, adminC.token, { name: "Case", active_pog_version_id: C.version })).json.data);
    expect((await createScan(adminC.id, d.display_id)).error).toBeNull();
    expect((await patch(`/api/v1/stores/${s.store_id}`, adminC.token, { expected_revision: 1, active: false })).status).toBe(200);
    expect((await createScan(adminC.id, d.display_id)).error?.message).toBe("VALIDATION_FAILED");
    expect((await post(`/api/v1/stores/${s.store_id}/displays`, adminC.token, { name: "Late" })).json.error.field_errors).toEqual({ store_id: ["store is archived"] });

    const active = page(Store).parse((await h.api("/api/v1/stores?limit=100", { token: adminC.token })).json.data).items.map((x) => x.store_id);
    const archived = page(Store).parse((await h.api("/api/v1/stores?status=archived&limit=100", { token: adminC.token })).json.data).items.map((x) => x.store_id);
    expect(active).not.toContain(s.store_id);
    expect(archived).toContain(s.store_id);
    // Archived lists are for managers/admins; an employee asking is refused rather than shown more.
    expect((await h.api("/api/v1/stores?status=archived", { token: employeeC1.token })).status).toBe(403);
    // Managers see archived stores they manage only.
    expect(page(Store).parse((await h.api("/api/v1/stores?status=archived", { token: managerC1.token })).json.data).items).toEqual([]);
  });

  it("renaming a product does not change the names recorded in an existing scan", async () => {
    const p = Product.parse((await post("/api/v1/products", adminC.token, { name: `Original ${h.run}`, short_name: "Orig", category: "salad", container_type: "bowl" })).json.data);
    const { versionId } = await publishedVersion(C.org, p.product_id);
    const d = Display.parse((await post(`/api/v1/stores/${C.store1}/displays`, managerC1.token, { name: `Snapshot ${h.run}`, active_pog_version_id: versionId })).json.data);
    const scanId = (await createScan(employeeC1.id, d.display_id)).data![0]!.scan_id;

    const renamed = await patch(`/api/v1/products/${p.product_id}`, adminC.token, { expected_revision: 1, name: `Renamed ${h.run}` });
    expect(renamed.status).toBe(200);
    expect(await row("select product_name_snapshot from public.scan_slots where scan_id = $1", [scanId])).toEqual({ product_name_snapshot: `Original ${h.run}` });

    // Archiving the product keeps it readable and flags the display for a new version.
    expect((await patch(`/api/v1/products/${p.product_id}`, adminC.token, { expected_revision: 2, active: false })).status).toBe(200);
    const flagged = page(Display).parse((await h.api(`/api/v1/stores/${C.store1}/displays?limit=100`, { token: managerC1.token })).json.data).items;
    expect(flagged.find((x) => x.display_id === d.display_id)?.has_archived_products).toBe(true);
    expect(await row("select product_name_snapshot from public.scan_slots where scan_id = $1", [scanId])).toEqual({ product_name_snapshot: `Original ${h.run}` });
  });
});

describe("lists", () => {
  it("pages with an opaque cursor and rejects forged cursors", async () => {
    const first = await h.api("/api/v1/stores?limit=1", { token: adminC.token });
    const page1 = page(Store).parse(first.json.data);
    expect(page1.items).toHaveLength(1);
    expect(page1.next_cursor).toBeTruthy();
    const page2 = page(Store).parse((await h.api(`/api/v1/stores?limit=1&cursor=${page1.next_cursor}`, { token: adminC.token })).json.data);
    expect(page2.items[0]!.store_id).not.toBe(page1.items[0]!.store_id);
    for (const cursor of ["not-a-cursor", Buffer.from('["2026-01-01T00:00:00+00:00","x"]').toString("base64url")]) {
      const bad = await h.api(`/api/v1/stores?cursor=${cursor}`, { token: adminC.token });
      expect(bad.status).toBe(422);
      expect(bad.json.error.field_errors.cursor).toBeDefined();
    }
    expect((await h.api("/api/v1/stores?limit=101", { token: adminC.token })).status).toBe(422);
    expect((await h.api("/api/v1/stores?status=deleted", { token: adminC.token })).status).toBe(422);
  });

  it("filters never widen access: a manager's store list is their assigned store only", async () => {
    const all = page(Store).parse((await h.api("/api/v1/stores?status=all&limit=100", { token: managerC1.token })).json.data).items;
    expect(all.map((s) => s.store_id)).toEqual([C.store1]);
    expect((await h.api(`/api/v1/stores?organization_id=${SEED.orgB}`, { token: managerC1.token })).status).toBe(404);
  });
});

describe("web session", () => {
  it("cookie mutations need the app Origin; with it, the same routes work", async () => {
    const { jar } = await h.webSignIn(adminC);
    const body = { name: "Cookie store", store_number: `CK-${h.run}`, timezone: "UTC" };
    for (const headers of [{ origin: "http://evil.example" }, {}] as Array<Record<string, string>>) {
      const res = await h.api("/api/v1/stores", { method: "POST", jar, headers: { ...headers, "idempotency-key": key() }, body });
      expect(res.status).toBe(403);
    }
    expect((await h.db.query("select 1 from public.stores where store_number = $1", [`CK-${h.run}`])).rowCount).toBe(0);
    const ok = await h.api("/api/v1/stores", { method: "POST", jar, headers: { origin: h.base, "idempotency-key": key() }, body });
    expect(ok.status, ok.text).toBe(201);
  });

  it("pages show the next authorized action when lists are empty", async () => {
    const org = await row<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [`Empty org ${h.run}`]);
    const admin = await h.user("c-empty-admin", { org: { id: org.id, role: "admin" } });
    const { jar } = await h.webSignIn(admin);
    const stores = await h.page("/stores", jar);
    expect(stores.status).toBe(200);
    expect(stores.html).toContain("No stores yet");
    expect(stores.html).toContain("Add a store");
    const products = await h.page("/products", jar);
    expect(products.html).toContain("No products yet");
    expect(products.html).toContain("Add a product");
    const displays = await h.page("/displays", jar);
    expect(displays.html).toContain("Create a store on the Stores page first");

    // A manager of a store without displays is offered "Add a display"; Stores is read-only for them.
    const store = await row<{ id: string }>("insert into public.stores (organization_id, name, store_number, timezone) values ($1, 'Fresh', 'F-1', 'UTC') returning id", [org.id]);
    const manager = await h.user("c-empty-manager", { org: { id: org.id, role: "member" }, stores: [{ id: store.id, role: "manager" }] });
    const managerJar = (await h.webSignIn(manager)).jar;
    const managerDisplays = await h.page("/displays", managerJar);
    expect(managerDisplays.html).toContain("No displays in Fresh yet");
    expect(managerDisplays.html).toContain("Add a display");
    const managerStores = await h.page("/stores", managerJar);
    expect(managerStores.html).toContain("Only organization admins can add, edit or archive stores");
    expect(managerStores.html).not.toContain("Add a store");
  });
});
