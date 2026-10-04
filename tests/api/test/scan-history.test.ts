// Feature 11 over HTTP: stable newest-first history pagination, filters that
// cannot widen RLS, one authorization boundary for list / detail / record /
// image, an immutable review record after configuration edits, explicit
// retention-deleted photos and the web review pages.
import { randomUUID } from "node:crypto";
import { createLogger, MockVisionAdapter } from "@display-refill/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { attemptPolicy, processJob } from "../../../workers/scan-worker/src/pipeline";
import { runCleanup } from "../../../workers/scan-worker/src/retention";
import { SupabaseQueueStore } from "../../../workers/scan-worker/src/queue";
import { adminBaseUrl, type ApiUser, createHarness, type Harness, SEED } from "../src/harness";

let h: Harness;
let owner: ApiUser, peer: ApiUser, emp2: ApiUser, mgr1: ApiUser, admin: ApiUser, otherAdmin: ApiUser, leaver: ApiUser;
let org: string, s1: string, s2: string, d1: string, d2: string, pog: string, version: string, product: string, referencePath: string;
const startedAt = new Date(Date.now() - 1000).toISOString();
const logger = createLogger("api-test-worker", "error", () => undefined);
const post = (path: string, body: unknown, user: ApiUser, key = randomUUID()) =>
  h.api(path, { method: "POST", token: user.token, body, headers: { "idempotency-key": key } });
const patch = (path: string, body: unknown, user: ApiUser, key = randomUUID()) =>
  h.api(path, { method: "PATCH", token: user.token, body, headers: { "idempotency-key": key } });
const get = (path: string, user?: ApiUser) => h.api(path, { token: user?.token });
const history = (user: ApiUser, query: Record<string, string> = {}) => get(`/api/v1/scans?${new URLSearchParams(query)}`, user);

/** Every page of a filtered list, asserting there is never a repeated row. */
async function allPages(user: ApiUser, query: Record<string, string>) {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const r = await history(user, { ...query, ...(cursor ? { cursor } : {}) });
    expect(r.status, r.text).toBe(200);
    ids.push(...r.json.data.items.map((i: { scan_id: string }) => i.scan_id));
    cursor = r.json.data.next_cursor;
  } while (cursor);
  expect(new Set(ids).size).toBe(ids.length);
  return ids;
}

async function manualScan(user: ApiUser, display: string) {
  // A later test assigns v2 to display 1; always pin the display's current version.
  const current = (await h.db.query("select active_pog_version_id from public.displays where id = $1", [display])).rows[0].active_pog_version_id as string;
  const r = await post("/api/v1/scans", { display_id: display, source: "manual", expected_pog_version_id: current }, user);
  expect(r.status, r.text).toBe(201);
  return r.json.data.scan_id as string;
}

async function photoScan(user: ApiUser, display: string) {
  const created = await post("/api/v1/scans", { display_id: display, source: "photo", expected_pog_version_id: version }, user);
  expect(created.status, created.text).toBe(201);
  const id = created.json.data.scan.scan_id as string;
  const jpeg = await sharp({ create: { width: 400, height: 100, channels: 3, background: "#aa3322" } }).jpeg().toBuffer();
  const put = await fetch(`${adminBaseUrl()}/api/v1/scans/${id}/image`, { method: "PUT", headers: { authorization: `Bearer ${user.token}` }, body: new Uint8Array(jpeg) });
  expect(put.status).toBe(200);
  const finalized = await post(`/api/v1/scans/${id}/finalize-upload`, { expected_revision: 1, crop: { x: 0, y: 0, width: 1, height: 1 } }, user);
  expect(finalized.status, finalized.text).toBe(200);
  return id;
}

async function analyse(id: string) {
  const queue = new SupabaseQueueStore(h.service);
  // Earlier tests in this file leave queued photos; only this scan is due.
  await h.db.query("update public.scan_jobs set available_at = case when scan_id = $1 then now() else now() + interval '1 day' end where state = 'queued'", [id]);
  const job = await queue.claim(attemptPolicy(new MockVisionAdapter("review")));
  expect(job?.scan_id).toBe(id);
  expect(await processJob({ queue, vision: new MockVisionAdapter("review"), logger }, job!)).toEqual({ status: "committed" });
}

beforeAll(async () => {
  h = await createHarness();
  [org, s1, s2, d1, d2, pog, version, product] = Array.from({ length: 8 }, () => randomUUID() as string) as [string, string, string, string, string, string, string, string];
  await h.db.query("insert into public.organizations(id,name) values($1,'History API synthetic')", [org]);
  await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$3,'History One','H1','UTC'),($2,$3,'History Two','H2','America/Toronto')", [s1, s2, org]);
  owner = await h.user("history-owner", { org: { id: org, role: "member" }, stores: [{ id: s1, role: "employee" }] });
  peer = await h.user("history-peer", { org: { id: org, role: "member" }, stores: [{ id: s1, role: "employee" }] });
  leaver = await h.user("history-leaver", { org: { id: org, role: "member" }, stores: [{ id: s1, role: "employee" }] });
  emp2 = await h.user("history-emp2", { org: { id: org, role: "member" }, stores: [{ id: s2, role: "employee" }] });
  mgr1 = await h.user("history-mgr1", { org: { id: org, role: "member" }, stores: [{ id: s1, role: "manager" }] });
  admin = await h.user("history-admin", { org: { id: org, role: "admin" } });
  otherAdmin = await h.user("history-other", { org: { id: SEED.orgB, role: "admin" } });
  await h.db.query("update public.profiles set display_name = 'Synthetic Owner' where user_id = $1", [owner.id]);
  await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Synthetic Fruit Cup','Fruit','fixture','cup')", [product, org]);
  await h.db.query("insert into public.pogs(id,organization_id,name) values($1,$2,'History Layout')", [pog, org]);
  referencePath = `${org}/${pog}/${version}/reference-fixture.jpg`;
  await h.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values($1,$2,$3,1,$4,400,100,now(),false)", [version, org, pog, referencePath]);
  await h.db.query(`insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order) values
    ($1,$2,'A1',$3,0,0,0.5,1,5,2,0),($1,$2,'A2',$3,0.5,0,0.5,1,4,null,1)`, [org, version, product]);
  const ref = await h.service.storage.from("pog-images").upload(referencePath, await sharp({ create: { width: 400, height: 100, channels: 3, background: "#224466" } }).jpeg().toBuffer(), { contentType: "image/jpeg", upsert: true });
  if (ref.error) throw ref.error;
  const published = await h.service.rpc("publish_pog_version", { p_actor: admin.id, p_version_id: version, p_expected_revision: 1 });
  if (published.error) throw published.error;
  await h.db.query("insert into public.displays(id,organization_id,store_id,name,active_pog_version_id) values($1,$3,$4,'History Case One',$6),($2,$3,$5,'History Case Two',$6)", [d1, d2, org, s1, s2, version]);
});

beforeEach(async () => {
  // Shared local database: park other organizations' due work so claims here only see this file's scans.
  await h.db.query("update public.scan_jobs j set available_at = now() + interval '1 day' from public.scans s where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'queued'", [org]);
  await h.db.query("update public.scan_jobs j set lease_until = now() + interval '1 day' from public.scans s where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'running'", [org]);
});

afterAll(() => h?.close());

it("pages newest first with no repeated or missing rows when timestamps are equal", async () => {
  // create_scan inside one transaction: now() is identical for all five rows.
  await h.db.query("begin");
  for (let i = 0; i < 5; i++) await h.db.query("select public.create_scan($1, $2, 'manual', $3)", [owner.id, d1, version]);
  await h.db.query("commit");
  await manualScan(owner, d1);
  await manualScan(peer, d1);
  const expected = (await h.db.query("select id, created_at from public.scans where store_id = $1 order by created_at desc, id desc", [s1])).rows;
  expect(new Set(expected.map((r) => String(r.created_at))).size).toBeLessThan(expected.length);

  const first = await history(owner, { store_id: s1, limit: "2" });
  expect(first.status, first.text).toBe(200);
  expect(first.json.data.items).toHaveLength(2);
  // A scan created while someone pages does not shift or repeat later pages.
  const late = await manualScan(owner, d1);
  const ids = [...first.json.data.items.map((i: { scan_id: string }) => i.scan_id), ...(await allPages(owner, { store_id: s1, limit: "2", cursor: first.json.data.next_cursor }))];
  expect(ids).toEqual(expected.map((r) => r.id));
  expect(ids).not.toContain(late);
  expect((await allPages(owner, { store_id: s1, limit: "3" }))[0]).toBe(late);

  const item = first.json.data.items[0];
  expect(item).toMatchObject({
    store: { store_id: s1, name: "History One", store_number: "H1", timezone: "UTC" },
    display: { display_id: d1, name: "History Case One" },
    pog: { pog_version_id: version, version_number: 1, pog_name: "History Layout" },
    source: "manual", status: "needs_review", total_refill: null, completed_at: null, image_state: "none", synthetic_analysis: false,
  });
  expect(Object.keys(item)).not.toContain("image_path");
});

it("filters narrow within the caller's stores and never reveal another store or organization", async () => {
  const inS2 = await manualScan(emp2, d2);
  const own = await allPages(owner, { from: startedAt });
  expect(own).not.toContain(inS2);
  for (const query of [{ store_id: s2 }, { display_id: d2 }, { organization_id: SEED.orgB }, { store_id: SEED.storeB1 }] as Array<Record<string, string>>) {
    const r = await history(owner, query);
    expect(r.status, JSON.stringify(query)).toBe(404);
    expect(JSON.stringify(r.json)).not.toContain("History Two");
  }
  expect((await history(mgr1, { store_id: s2 })).status).toBe(404);
  expect(await allPages(mgr1, { store_id: s1, from: startedAt })).not.toContain(inS2);
  for (const query of [{ organization_id: org }, { store_id: s1 }, { display_id: d1 }] as Array<Record<string, string>>) expect((await history(otherAdmin, query)).status).toBe(404);
  const foreign = await allPages(otherAdmin, { from: startedAt });
  const leaked = (await h.db.query("select id from public.scans where id = any($1::uuid[]) and organization_id = $2", [foreign, org])).rows;
  expect(leaked).toEqual([]);

  // The organization admin sees both stores; each filter narrows.
  expect(await allPages(admin, { store_id: s2 })).toEqual([inS2]);
  expect(await allPages(admin, { display_id: d2 })).toEqual([inS2]);
  expect((await allPages(admin, { organization_id: org, from: startedAt })).length).toBeGreaterThan(1);
  expect(await allPages(admin, { store_id: s1, status: "completed" })).toEqual([]);
  const created = (await h.db.query("select created_at from public.scans where id = $1", [inS2])).rows[0].created_at as Date;
  expect(await allPages(admin, { store_id: s2, from: created.toISOString(), to: new Date(created.getTime() + 1).toISOString() })).toEqual([inS2]);
  expect(await allPages(admin, { store_id: s2, to: created.toISOString() })).toEqual([]);

  for (const query of [{ cursor: "not-a-cursor" }, { status: "verified" }, { from: "2026-10-03", to: "x" }, { from: "2026-10-04T00:00:00Z", to: "2026-10-03T00:00:00Z" }, { limit: "101" }, { store: s1 }] as Array<Record<string, string>>) {
    const r = await history(admin, query);
    expect(r.status, JSON.stringify(query)).toBe(422);
  }
  expect((await get("/api/v1/scans")).status).toBe(401);
});

it("history, detail, record and image access agree for every role", async () => {
  const photo1 = await photoScan(owner, d1);
  const photo2 = await photoScan(emp2, d2);
  const manual1 = await manualScan(peer, d1);
  const scans = { [photo1]: s1, [photo2]: s2, [manual1]: s1 };
  const sees: Array<[ApiUser, string[]]> = [[owner, [s1]], [peer, [s1]], [leaver, [s1]], [mgr1, [s1]], [emp2, [s2]], [admin, [s1, s2]], [otherAdmin, []]];
  for (const [user, stores] of sees) {
    const listed = new Set(await allPages(user, { from: startedAt, limit: "100" }));
    for (const [id, store] of Object.entries(scans)) {
      const visible = stores.includes(store);
      const [detail, record, image] = await Promise.all([get(`/api/v1/scans/${id}`, user), get(`/api/v1/scans/${id}/history`, user), get(`/api/v1/scans/${id}/image`, user)]);
      const label = `${user.email} ${id}`;
      expect(listed.has(id), label).toBe(visible);
      expect([detail.status, record.status], label).toEqual(visible ? [200, 200] : [404, 404]);
      if (!visible) expect(image.status, label).toBe(404);
      else if (id === manual1) expect([image.status, image.json.error.message], label).toEqual([404, "This scan has no photo."]);
      else expect(image.status, label).toBe(200);
      if (visible) expect(record.json.data.scan).toEqual(detail.json.data);
    }
  }
  const link = (await get(`/api/v1/scans/${photo1}/image`, owner)).json.data;
  const bytes = await fetch(link.url);
  expect(bytes.status).toBe(200);
  expect(bytes.headers.get("content-type")).toBe("image/jpeg");

  // Store assignment removed while the access token is still valid: every route denies together.
  await h.db.query("update public.store_memberships set active = false where user_id = $1", [leaver.id]);
  expect(await allPages(leaver, { from: startedAt })).toEqual([]);
  for (const path of [`/api/v1/scans/${photo1}`, `/api/v1/scans/${photo1}/history`, `/api/v1/scans/${photo1}/image`]) expect((await get(path, leaver)).status).toBe(404);
  expect((await history(leaver, { store_id: s1 })).status).toBe(404);
  // No organization membership at all: 403 everywhere (D36).
  await h.db.query("update public.organization_memberships set active = false where user_id = $1", [leaver.id]);
  for (const path of ["/api/v1/scans", `/api/v1/scans/${photo1}/history`, `/api/v1/scans/${photo1}/image`]) expect((await get(path, leaver)).status).toBe(403);
});

it("keeps estimates, corrections, confirmation and completion distinct and unchanged after configuration edits; deleted photos keep their record", async () => {
  const id = await photoScan(owner, d1);
  await analyse(id);
  let scan = (await get(`/api/v1/scans/${id}`, owner)).json.data;
  const slot = Object.fromEntries(scan.slots.map((s: { slot_label: string; slot_id: string }) => [s.slot_label, s.slot_id]));
  const saved = await patch(`/api/v1/scans/${id}/counts`, { expected_revision: scan.revision, items: [
    { slot_id: slot.A1, quantity: 3, verified: true, reason: "visibility_check" },
    { slot_id: slot.A2, quantity: 1, verified: true, reason: "wrong_product" }] }, owner);
  expect(saved.status, saved.text).toBe(200);

  // Before confirmation the record carries only provisional recommendations.
  const provisional = (await get(`/api/v1/scans/${id}/history`, owner)).json.data;
  expect(provisional.scan).toMatchObject({ provisional: true, total_refill: null });
  expect(provisional.confirmation).toBeNull();
  expect(provisional.completion).toBeNull();
  // Another employee can read the store's record but cannot change it.
  expect((await patch(`/api/v1/scans/${id}/counts`, { expected_revision: saved.json.data.revision, items: [{ slot_id: slot.A1, quantity: 0, verified: true, reason: "count_corrected" }] }, peer)).status).toBe(403);
  for (const method of ["PATCH", "DELETE", "PUT"]) {
    expect((await h.api(`/api/v1/scans/${id}`, { method, token: peer.token, body: { status: "completed" }, headers: { "idempotency-key": randomUUID() } })).status).toBe(405);
  }
  expect((await h.api(`/api/v1/scans/${id}/history`, { method: "POST", token: peer.token, body: {}, headers: { "idempotency-key": randomUUID() } })).status).toBe(405);
  expect((await get(`/api/v1/scans/${id}`, owner)).json.data.revision).toBe(saved.json.data.revision);

  const confirmed = await post(`/api/v1/scans/${id}/confirm`, { expected_revision: saved.json.data.revision }, owner);
  expect(confirmed.status, confirmed.text).toBe(200);
  const completed = await post(`/api/v1/scans/${id}/complete`, { expected_revision: confirmed.json.data.revision }, owner);
  expect(completed.status, completed.text).toBe(200);

  const asOwner = (await get(`/api/v1/scans/${id}/history`, owner)).json.data;
  expect(asOwner.scan).toMatchObject({ status: "completed", provisional: false, total_refill: 3, analysis: { synthetic: true, provider: "mock" } });
  expect(asOwner.scan.slots.map((s: Record<string, unknown>) => [s.slot_label, s.product_name, s.target, s.ai_quantity, s.confidence, s.flags, s.accepted_quantity, s.final_quantity, s.refill_quantity])).toEqual([
    ["A1", "Synthetic Fruit Cup", 5, 3, 0.62, [], 3, 3, 0], ["A2", "Synthetic Fruit Cup", 4, 2, 0.91, ["wrong_product"], 1, 1, 3]]);
  expect(asOwner.corrections.map((c: Record<string, unknown>) => [c.slot_label, c.previous_quantity, c.corrected_quantity, c.original_ai_quantity, c.reason, c.verified])).toEqual([
    ["A1", 3, 3, 3, "visibility_check", true], ["A2", 2, 1, 2, "wrong_product", true]]);
  expect(asOwner.corrections[0].actor).toEqual({ user_id: owner.id, is_you: true, display_name: null });
  expect(asOwner.confirmation).toMatchObject({ total_refill: 3, confirmed_by: { user_id: owner.id, is_you: true } });
  expect(asOwner.completion).toMatchObject({ attested_by: { user_id: owner.id, is_you: true } });
  expect(asOwner).toMatchObject({ image: { state: "retained", deleted_at: null }, analysis_attempts: null, viewer: { staff_names_visible: false, analysis_metadata_visible: false } });

  // Managers of the store see names and analysis versions, never usage, leases or hashes.
  const asManager = (await get(`/api/v1/scans/${id}/history`, mgr1)).json.data;
  expect(asManager.created_by).toEqual({ user_id: owner.id, is_you: false, display_name: "Synthetic Owner" });
  expect(asManager.analysis_attempts).toHaveLength(1);
  expect(asManager.analysis_attempts[0]).toMatchObject({ provider: "mock", prompt_version: "count-v1", policy_version: "review-v1", confidence_threshold: 0.8, outcome: "succeeded" });
  expect(Object.keys(asManager.analysis_attempts[0]).sort()).toEqual(["attempt_number", "confidence_threshold", "ended_at", "error_code", "generation", "model", "outcome", "policy_version", "prompt_version", "provider", "schema_version", "started_at"]);
  const listed = (await history(mgr1, { store_id: s1, status: "completed" })).json.data.items.find((i: { scan_id: string }) => i.scan_id === id);
  expect(listed).toMatchObject({ total_refill: 3, synthetic_analysis: true, image_state: "retained", pog: { version_number: 1 } });

  // Configuration edits: rename and archive the product, publish and assign v2 with new targets, rename the display.
  const revision = async (table: string, rowId: string) => (await h.db.query(`select revision from public.${table} where id = $1`, [rowId])).rows[0].revision as number;
  expect((await patch(`/api/v1/products/${product}`, { expected_revision: await revision("products", product), name: "Renamed Product" }, admin)).status).toBe(200);
  const v2 = randomUUID();
  await h.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values($1,$2,$3,2,$4,400,100,now(),false)", [v2, org, pog, referencePath]);
  await h.db.query(`insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order) values
    ($1,$2,'B1',$3,0,0,1,1,9,1,0)`, [org, v2, product]);
  const pub = await h.service.rpc("publish_pog_version", { p_actor: admin.id, p_version_id: v2, p_expected_revision: 1 });
  expect(pub.error).toBeNull();
  expect((await patch(`/api/v1/displays/${d1}`, { expected_revision: await revision("displays", d1), name: "Renamed Case", active_pog_version_id: v2 }, admin)).status).toBe(200);
  expect((await patch(`/api/v1/products/${product}`, { expected_revision: await revision("products", product), active: false }, admin)).status).toBe(200);

  const after = (await get(`/api/v1/scans/${id}/history`, mgr1)).json.data;
  expect(after.scan).toEqual(asManager.scan);
  expect(after.corrections).toEqual(asManager.corrections);
  expect(after.confirmation).toEqual(asManager.confirmation);
  expect(after.completion).toEqual(asManager.completion);
  expect(after.pog).toEqual(asManager.pog);
  // Display and template names are current labels (D74); the scan keeps its pinned version.
  expect(after.display.name).toBe("Renamed Case");
  expect((await history(mgr1, { display_id: d1, status: "completed" })).json.data.items.find((i: { scan_id: string }) => i.scan_id === id).pog.version_number).toBe(1);

  // Synthetic clock fixture: run the actual Feature 12 cleanup through Storage.
  await h.db.query("begin");
  try {
    await h.db.query("set local session_replication_role='replica'");
    await h.db.query("update public.scans set created_at=now()-interval '91 days' where id=$1", [id]);
    await h.db.query("commit");
  } catch (error) { await h.db.query("rollback"); throw error; }
  await runCleanup(h.service, logger);
  const removed = (await get(`/api/v1/scans/${id}/history`, owner)).json.data;
  expect(removed.image.state).toBe("deleted");
  expect(removed.image.deleted_at).toMatch(/Z$/);
  expect(removed.scan.image_available).toBe(false);
  expect(removed.corrections).toEqual(asOwner.corrections);
  expect(removed.scan.slots).toEqual(asOwner.scan.slots);
  const gone = await get(`/api/v1/scans/${id}/image`, owner);
  expect([gone.status, gone.json.error.code, gone.json.error.message]).toEqual([410, "IMAGE_DELETED", "Photo removed under retention policy. Counts and review history remain."]);
  expect((await get(`/api/v1/scans/${id}/image`, otherAdmin)).status).toBe(404);
  expect((await history(owner, { display_id: d1, status: "completed" })).json.data.items.find((i: { scan_id: string }) => i.scan_id === id).image_state).toBe("deleted");
});

it("web review pages show assigned stores to managers, the organization to admins and nothing to employees", async () => {
  const inS2 = await manualScan(emp2, d2);
  const inS1 = await manualScan(owner, d1);
  const [{ jar: managerJar }, { jar: adminJar }, { jar: employeeJar }] = await Promise.all([h.webSignIn(mgr1), h.webSignIn(admin), h.webSignIn(owner)]);
  const listing = await h.page(`/scans?store_id=${s1}`, managerJar);
  expect(listing.status).toBe(200);
  expect(listing.html).toContain("History One");
  expect(listing.html).toContain(`/scans/${inS1}`);
  expect(listing.html).toContain("Not confirmed");
  const own = await h.page(`/scans/${inS1}`, managerJar);
  expect(own.html).toContain("Provisional recommendation");
  expect(own.html).toContain("Completion attestation");
  expect(own.html).toContain("Manual check: no photo was taken.");
  expect(listing.html).not.toContain(inS2);
  const foreign = await h.page(`/scans?store_id=${s2}`, managerJar);
  expect(foreign.html).toContain("Store not found");
  expect(foreign.html).not.toContain(inS2);
  const record = await h.page(`/scans/${inS2}`, managerJar);
  expect(record.html).toContain("Scan not found");
  expect(record.html).not.toContain("History Two");
  const adminView = await h.page(`/scans/${inS2}`, adminJar);
  expect(adminView.status).toBe(200);
  expect(adminView.html).toContain("History Case Two");
  expect(adminView.html).toContain("Provisional");
  expect((await h.page(`/scans?store_id=${s2}`, adminJar)).html).toContain(inS2);
  const employee = await h.page("/scans", employeeJar);
  expect(employee.location).toBe("/no-access?reason=employee");
});

it("operator vision disable returns manual guidance without weakening history authorization or manual creation", async () => {
  await h.db.query("update public.operation_settings set vision_enabled=false,updated_at=now()");
  try {
    const blocked = await post("/api/v1/scans", { display_id: d2, source: "photo", expected_pog_version_id: version }, emp2);
    expect(blocked.status, blocked.text).toBe(503);
    expect(blocked.json.error.message).toContain("manual");
    const id = await manualScan(emp2, d2);
    expect((await get(`/api/v1/scans/${id}`, emp2)).status).toBe(200);
    expect((await get(`/api/v1/scans/${id}/history`, owner)).status).toBe(404);
    expect((await get(`/api/v1/scans/${id}/image`, owner)).status).toBe(404);
  } finally {
    await h.db.query("update public.operation_settings set vision_enabled=true,updated_at=now()");
  }
});
