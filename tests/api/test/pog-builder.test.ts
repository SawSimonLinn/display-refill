import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PogVersionDetail, type PogSlotInput } from "@display-refill/domain";
import { createClient } from "@supabase/supabase-js";
import { createHarness, type ApiUser, type Harness, SEED } from "../src/harness";

let h: Harness;
let admin: ApiUser, other: ApiUser, manager: ApiUser, employee: ApiUser;
let org: string, store: string, product: string, inactive: string;
let jpeg: Buffer;
const whole = { x: 0, y: 0, width: 1, height: 1 };
const mutation = (path: string, body: unknown, token = admin.token, key = randomUUID(), method = "POST") =>
  h.api(path, { method, token, body, headers: { "idempotency-key": key } });
const slots = (over: Partial<PogSlotInput> = {}): PogSlotInput[] => [{ label: "A1", product_id: product, ...whole, target_quantity: 5, refill_threshold: 2, sort_order: 0, ...over }];
const prefix = (v: PogVersionDetail) => `/api/v1/pog-versions/${v.pog_version_id}`;
async function draft() {
  const res = await mutation("/api/v1/pogs", { name: `Builder ${randomUUID()}` });
  expect(res.status, res.text).toBe(201);
  return detail(res.json.data.pog_id, res.json.data.versions[0].pog_version_id);
}
async function detail(pog: string, version: string, token = admin.token) {
  const res = await h.api(`/api/v1/pogs/${pog}/versions/${version}`, { token });
  expect(res.status, res.text).toBe(200);
  return PogVersionDetail.parse(res.json.data);
}
async function intent(v: PogVersionDetail) {
  const res = await mutation(`${prefix(v)}/upload-intent`, {});
  expect(res.status, res.text).toBe(201);
  return res.json.data as { upload_id: string; upload_url: string; object_path: string };
}
async function upload(v: PogVersionDetail, bytes = jpeg) {
  const u = await intent(v);
  const res = await fetch(u.upload_url, { method: "PUT", headers: { "content-type": "image/jpeg", authorization: `Bearer ${admin.token}` }, body: new Uint8Array(bytes) });
  expect(res.ok, await res.text()).toBe(true);
  return u;
}
async function reference(v: PogVersionDetail) {
  const u = await upload(v);
  const body = { upload_id: u.upload_id, expected_revision: v.revision, rotation: 0, crop: whole };
  const key = randomUUID();
  const res = await mutation(`${prefix(v)}/finalize-image`, body, admin.token, key);
  expect(res.status, res.text).toBe(200);
  const replay = await mutation(`${prefix(v)}/finalize-image`, body, admin.token, key);
  expect(replay.json).toEqual(res.json);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect((await h.service.storage.from("pog-images").download(u.object_path)).error).not.toBeNull();
  return PogVersionDetail.parse(res.json.data);
}
async function save(v: PogVersionDetail, values = slots(), confirm = false) {
  const res = await mutation(`${prefix(v)}/slots`, { expected_revision: v.revision, slots: values, confirm_coordinates: confirm }, admin.token, randomUUID(), "PUT");
  expect(res.status, res.text).toBe(200);
  return PogVersionDetail.parse(res.json.data);
}
async function publish(v: PogVersionDetail) {
  const res = await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision });
  expect(res.status, res.text).toBe(200);
  return PogVersionDetail.parse(res.json.data);
}
const snapshot = async (id: string) => (await h.db.query("select pog_version_id, product_name_snapshot, slot_label_snapshot, target_snapshot, threshold_snapshot from public.scan_slots where scan_id=$1 order by id", [id])).rows;

beforeAll(async () => {
  h = await createHarness();
  org = (await h.db.query("insert into public.organizations(name) values($1) returning id", [`POG tests ${h.run}`])).rows[0].id;
  admin = await h.user("pog-admin", { org: { id: org, role: "admin" } });
  other = await h.user("pog-other-admin", { org: { id: SEED.orgB, role: "admin" } });
  const s = await mutation("/api/v1/stores", { name: "POG store", store_number: h.run, timezone: "UTC" });
  store = s.json.data.store_id;
  manager = await h.user("pog-manager", { org: { id: org, role: "member" }, stores: [{ id: store, role: "manager" }] });
  employee = await h.user("pog-employee", { org: { id: org, role: "member" }, stores: [{ id: store, role: "employee" }] });
  const p = await mutation("/api/v1/products", { name: "Original Salad", short_name: "Salad", category: "salad", container_type: "bowl" });
  product = p.json.data.product_id;
  const i = await mutation("/api/v1/products", { name: "Archived", short_name: "Old", category: "salad", container_type: "bowl" });
  inactive = i.json.data.product_id;
  await mutation(`/api/v1/products/${inactive}`, { expected_revision: 1, active: false }, admin.token, randomUUID(), "PATCH");
  jpeg = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#88aa44" } }).withExif({ IFD0: { Copyright: "metadata must be removed" } }).jpeg().toBuffer();
});
afterAll(() => h?.close());

describe("real reference → edit → publish → assign workflow", () => {
  it("publishes separately, clones immutable versions and preserves pinned scan snapshots after reassignment", async () => {
    let v = await draft();
    v = await reference(v);
    v = await save(v);
    const key = randomUUID();
    const body = { expected_revision: v.revision };
    const first = await mutation(`${prefix(v)}/publish`, body, admin.token, key);
    expect(first.status, first.text).toBe(200);
    const replay = await mutation(`${prefix(v)}/publish`, body, admin.token, key);
    expect(replay.json).toEqual(first.json);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision + 1 }, admin.token, key)).status).toBe(409);
    v = PogVersionDetail.parse(first.json.data);
    expect(v.state).toBe("published");
    expect((await h.db.query("select id from public.displays where active_pog_version_id=$1", [v.pog_version_id])).rowCount).toBe(0);
    const d = await mutation(`/api/v1/stores/${store}/displays`, { name: "POG case", active_pog_version_id: v.pog_version_id }, manager.token);
    expect(d.status, d.text).toBe(201);
    const display = d.json.data.display_id;
    const scan = await h.service.rpc("create_scan", { p_actor: employee.id, p_display_id: display, p_source: "manual", p_expected_pog_version_id: v.pog_version_id });
    expect(scan.error).toBeNull();
    const scanId = scan.data![0]!.scan_id;
    const before = await snapshot(scanId);
    const cloned = await mutation(`/api/v1/pogs/${v.pog_id}/versions`, { source_version_id: v.pog_version_id });
    expect(cloned.status, cloned.text).toBe(201);
    let next = PogVersionDetail.parse(cloned.json.data);
    expect(next).toMatchObject({ state: "draft", version_number: 2, source_version_id: v.pog_version_id, reference: v.reference });
    expect(next.slots[0]!.slot_id).not.toBe(v.slots[0]!.slot_id);
    next = await save(next, slots({ label: "New label", target_quantity: 9 }));
    next = await publish(next);
    expect((await h.api(`/api/v1/displays/${display}`, { token: manager.token })).json.data.display.active_pog.pog_version_id).toBe(v.pog_version_id);
    const assigned = await mutation(`/api/v1/displays/${display}`, { expected_revision: 1, active_pog_version_id: next.pog_version_id }, manager.token, randomUUID(), "PATCH");
    expect(assigned.status, assigned.text).toBe(200);
    await mutation(`/api/v1/products/${product}`, { expected_revision: 1, name: "Renamed Salad" }, admin.token, randomUUID(), "PATCH");
    expect(await snapshot(scanId)).toEqual(before);
    expect((await h.db.query("select pog_version_id from public.scans where id=$1", [scanId])).rows[0].pog_version_id).toBe(v.pog_version_id);
    expect((await mutation(`${prefix(v)}/slots`, { expected_revision: v.revision, slots: [] }, admin.token, randomUUID(), "PUT")).status).toBe(409);
    expect((await mutation(`${prefix(v)}/upload-intent`, {})).status).toBe(409);
    expect((await h.service.from("pog_versions").update({ reference_width: 12 }).eq("id", v.pog_version_id)).error?.message).toBe("IMMUTABLE");
    expect((await h.service.from("pog_slots").update({ target_quantity: 7 }).eq("id", v.slots[0]!.slot_id)).error?.message).toBe("IMMUTABLE");
    expect((await detail(v.pog_id, v.pog_version_id)).slots[0]!.label).toBe("A1");
    const audit = (await h.db.query("select event_type from public.audit_events where resource_id=$1", [v.pog_version_id])).rows.map((r) => r.event_type);
    expect(audit).toEqual(expect.arrayContaining(["pog_version.reference_set", "pog_version.slots_saved", "pog_version.published"]));
    expect(audit.filter((x) => x === "pog_version.published")).toHaveLength(1);
    // Historical image remains readable even after the display uses v2.
    expect((await mutation(`${prefix(v)}/image-access`, {}, employee.token)).status).toBe(200);
  });

  it("replacement requires explicit coordinate revalidation; stale review cannot confirm a newer image", async () => {
    let v = await save(await reference(await draft()));
    const stale = v;
    v = await reference(v);
    expect(v.slots_need_review).toBe(true);
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
    expect((await mutation(`${prefix(v)}/slots`, { expected_revision: stale.revision, slots: slots(), confirm_coordinates: true }, admin.token, randomUUID(), "PUT")).status).toBe(409);
    v = await save(v);
    expect(v.slots_need_review).toBe(true);
    v = await save(v, slots(), true);
    expect(v.slots_need_review).toBe(false);
    expect((await publish(v)).state).toBe("published");
  });
});

describe("publication validation and image boundaries", () => {
  it("refuses missing/unvalidated references, empty layouts, overlaps and archived products without publishing", async () => {
    let v = await draft();
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
    v = await save(v);
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
    v = await reference(v);
    v = await save(v, [], true);
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
    v = await save(v, [...slots({ width: 0.6 }), ...slots({ label: "B1", x: 0.5, width: 0.5, sort_order: 1 })]);
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
    v = await save(v, slots({ product_id: inactive }));
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
    expect((await detail(v.pog_id, v.pog_version_id)).state).toBe("draft");
    const audit = await h.db.query("select 1 from public.audit_events where resource_id=$1 and event_type='pog_version.published'", [v.pog_version_id]);
    expect(audit.rowCount).toBe(0);
  });

  it("refuses publication when a validated reference object is missing", async () => {
    const v = await save(await reference(await draft()));
    const path = (await h.db.query("select reference_path from public.pog_versions where id=$1", [v.pog_version_id])).rows[0].reference_path;
    await h.service.storage.from("pog-images").remove([path]);
    const res = await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision });
    expect(res.status).toBe(422);
    expect(res.json.error.field_errors.reference_image).toBeDefined();
    expect((await detail(v.pog_id, v.pog_version_id)).state).toBe("draft");
  });

  it("rejects invalid coordinates, targets, triggers, labels and cross-organization products on save", async () => {
    const v = await reference(await draft());
    for (const values of [slots({ x: 0.5 }), slots({ width: 0 }), slots({ target_quantity: 0 }), slots({ target_quantity: 1.5 }), slots({ refill_threshold: 6 }), slots({ refill_threshold: -1 }), slots({ product_id: SEED.productCobb }), [...slots({ width: 0.5 }), ...slots({ label: "a1", x: 0.5, width: 0.5 })]]) {
      const res = await mutation(`${prefix(v)}/slots`, { expected_revision: v.revision, slots: values }, admin.token, randomUUID(), "PUT");
      expect(res.status, res.text).toBe(422);
    }
    expect((await detail(v.pog_id, v.pog_version_id)).slots).toEqual([]);
    expect((await mutation(`${prefix(v)}/publish`, { expected_revision: v.revision })).status).toBe(422);
  });

  it("validates decoded bytes, removes rejected staging objects and enforces write-once uploads", async () => {
    const v = await draft();
    for (const bytes of [Buffer.from("not a JPEG"), await sharp({ create: { width: 4100, height: 100, channels: 3, background: "red" } }).jpeg().toBuffer(), Buffer.from([255, 216, 255, 224, 0, 0])]) {
      const u = await upload(v, bytes);
      expect((await mutation(`${prefix(v)}/finalize-image`, { upload_id: u.upload_id, expected_revision: v.revision, crop: whole })).status).toBe(422);
      expect((await h.service.storage.from("pog-images").download(u.object_path)).error).not.toBeNull();
      expect((await h.db.query("select state from public.upload_intents where id=$1", [u.upload_id])).rows[0].state).toBe("rejected");
    }
    const u = await upload(v);
    const overwrite = await fetch(u.upload_url, { method: "PUT", headers: { "content-type": "image/jpeg", authorization: `Bearer ${admin.token}` }, body: new Uint8Array(Buffer.from("different bytes")) });
    expect(overwrite.status).toBe(409);
    await h.db.query("update public.upload_intents set created_at=now()-interval '20 minutes', expires_at=now()-interval '1 second' where id=$1", [u.upload_id]);
    const expiredPut = await fetch(u.upload_url, { method: "PUT", headers: { "content-type": "image/jpeg", authorization: `Bearer ${admin.token}` }, body: new Uint8Array(jpeg) });
    expect(expiredPut.status).toBe(409);
    expect((await mutation(`${prefix(v)}/finalize-image`, { upload_id: u.upload_id, expected_revision: v.revision })).status).toBe(422);
    expect((await h.service.storage.from("pog-images").download(u.object_path)).error).not.toBeNull();
  });

  it("denies authoring and image access at API, RPC, RLS and Storage boundaries", async () => {
    let v = await reference(await draft());
    v = await save(v);
    for (const u of [manager, employee, other]) {
      const denied = u === other ? 404 : 403;
      for (const action of ["upload-intent", "publish"]) expect((await mutation(`${prefix(v)}/${action}`, action === "publish" ? { expected_revision: v.revision } : {}, u.token)).status).toBe(denied);
      expect((await mutation(`${prefix(v)}/slots`, { expected_revision: v.revision, slots: slots() }, u.token, randomUUID(), "PUT")).status).toBe(denied);
      expect((await mutation(`${prefix(v)}/image-access`, {}, u.token)).status).toBe(404);
      const rpc = await h.service.rpc("replace_pog_slots", { p_actor: u.id, p_version_id: v.pog_version_id, p_expected_revision: v.revision, p_slots: [], p_confirm_coordinates: true });
      expect(rpc.error?.message).toBe(u === other ? "NOT_FOUND" : "FORBIDDEN");
    }
    const grant = await intent(v);
    for (const u of [manager, employee, other]) {
      const response = await fetch(grant.upload_url, { method: "PUT", headers: { "content-type": "image/jpeg", authorization: `Bearer ${u.token}` }, body: new Uint8Array(jpeg) });
      expect(response.status).toBe(u === other ? 404 : 403);
    }
    const caller = createClient(h.env.apiUrl, h.env.publishableKey, { global: { headers: { Authorization: `Bearer ${employee.token}` } }, auth: { persistSession: false } });
    expect((await caller.from("pog_versions").select("id").eq("id", v.pog_version_id)).data).toEqual([]);
    expect((await caller.rpc("publish_pog_version", { p_actor: admin.id, p_version_id: v.pog_version_id, p_expected_revision: v.revision })).error).not.toBeNull();
    const row = (await h.db.query("select reference_path from public.pog_versions where id=$1", [v.pog_version_id])).rows[0];
    expect((await caller.storage.from("pog-images").download(row.reference_path)).error).not.toBeNull();
    expect((await h.api(`${prefix(v)}/image-access`, { method: "POST", body: {}, headers: { origin: h.base } })).status).toBe(401);
    v = await publish(v);
    expect((await mutation(`${prefix(v)}/image-access`, {}, manager.token)).status).toBe(200);
    expect((await mutation(`${prefix(v)}/image-access`, {}, employee.token)).status).toBe(404);
    const url = (await mutation(`${prefix(v)}/image-access`, {})).json.data.url;
    expect((await fetch(url)).ok).toBe(true);
    const image = await h.service.storage.from("pog-images").download(row.reference_path);
    expect((await sharp(new Uint8Array(await image.data!.arrayBuffer())).metadata()).exif).toBeUndefined();
    const { jar } = await h.webSignIn(admin);
    expect((await h.api(`${prefix(v)}/image-access`, { method: "POST", jar, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
  it("revocation blocks an already-issued reference upload grant with a live token", async () => {
    const secondAdmin = await h.user("pog-revoked-admin", { org: { id: org, role: "admin" } });
    const v = await draft();
    const grant = await mutation(`${prefix(v)}/upload-intent`, {}, secondAdmin.token);
    expect(grant.status).toBe(201);
    const wrongActor = await fetch(grant.json.data.upload_url, { method: "PUT", headers: { "content-type": "image/jpeg", authorization: `Bearer ${admin.token}` }, body: new Uint8Array(jpeg) });
    expect(wrongActor.status).toBe(404);
    await h.service.from("organization_memberships").update({ active: false }).eq("organization_id", org).eq("user_id", secondAdmin.id);
    const response = await fetch(grant.json.data.upload_url, { method: "PUT", headers: { "content-type": "image/jpeg", authorization: `Bearer ${secondAdmin.token}` }, body: new Uint8Array(jpeg) });
    expect(response.status).toBe(403);
    expect((await mutation(`${prefix(v)}/finalize-image`, { upload_id: grant.json.data.upload_id, expected_revision: v.revision }, secondAdmin.token)).status).toBe(403);
    expect((await h.service.storage.from("pog-images").download(grant.json.data.object_path)).error).not.toBeNull();
  });

});

describe("concurrent edits and finalizations", () => {
  it("allows one concurrent save/publication and one new draft, with deterministic conflicts", async () => {
    let v = await save(await reference(await draft()));
    const results = await Promise.all([
      mutation(`${prefix(v)}/slots`, { expected_revision: v.revision, slots: slots({ target_quantity: 8 }) }, admin.token, randomUUID(), "PUT"),
      mutation(`${prefix(v)}/publish`, { expected_revision: v.revision }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    v = await detail(v.pog_id, v.pog_version_id);
    if (v.state === "draft") v = await publish(v);
    const drafts = await Promise.all([1, 2].map(() => mutation(`/api/v1/pogs/${v.pog_id}/versions`, { source_version_id: v.pog_version_id })));
    expect(drafts.map((r) => r.status).sort()).toEqual([201, 409]);
    const next = PogVersionDetail.parse(drafts.find((r) => r.status === 201)!.json.data);
    const pubs = await Promise.all([1, 2].map(() => mutation(`${prefix(next)}/publish`, { expected_revision: next.revision })));
    expect(pubs.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("replays a concurrently retried slot save without another revision or audit event", async () => {
    const v = await reference(await draft());
    const key = randomUUID(), body = { expected_revision: v.revision, slots: slots() };
    const results = await Promise.all([1, 2].map(() => mutation(`${prefix(v)}/slots`, body, admin.token, key, "PUT")));
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const replay = await mutation(`${prefix(v)}/slots`, body, admin.token, key, "PUT");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.json).toEqual(results.find((r) => r.status === 200)!.json);
    expect((await detail(v.pog_id, v.pog_version_id)).revision).toBe(v.revision + 1);
    expect((await h.db.query("select 1 from public.audit_events where resource_id=$1 and event_type='pog_version.slots_saved'", [v.pog_version_id])).rowCount).toBe(1);
  });

  it("different crops of one upload cannot overwrite the winning reference after publication", async () => {
    const v = await draft();
    const u = await upload(v);
    const results = await Promise.all([whole, { x: 0.5, y: 0, width: 0.5, height: 1 }].map((crop) => mutation(`${prefix(v)}/finalize-image`, { upload_id: u.upload_id, expected_revision: v.revision, crop })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    let winner = PogVersionDetail.parse(results.find((r) => r.status === 200)!.json.data);
    const path = (await h.db.query("select reference_path from public.pog_versions where id=$1", [v.pog_version_id])).rows[0].reference_path;
    const bytes = await h.service.storage.from("pog-images").download(path);
    expect(bytes.error).toBeNull();
    const buffer = new Uint8Array(await bytes.data!.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    expect([metadata.width, metadata.height]).toEqual([winner.reference!.width, winner.reference!.height]);
    expect(path).toContain(createHash("sha256").update(buffer).digest("hex"));
    winner = await publish(await save(winner));
    const late = await mutation(`${prefix(winner)}/finalize-image`, { upload_id: u.upload_id, expected_revision: winner.revision, crop: whole });
    expect(late.status).toBe(409);
    const after = await h.service.storage.from("pog-images").download(path);
    expect(new Uint8Array(await after.data!.arrayBuffer())).toEqual(buffer);
  });
});
