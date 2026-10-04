// Feature 10 over HTTP: confidence review routing, explicit acceptance of
// unchanged estimates, append-only corrections that never touch AI evidence,
// two-device conflicts, frozen confirmation and takeover from failed analysis.
import { randomUUID } from "node:crypto";
import { calculateRefill } from "@display-refill/domain";
import { createLogger, MockVisionAdapter, type VisionAdapter, VisionProviderError } from "@display-refill/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { attemptPolicy, processJob } from "../../../workers/scan-worker/src/pipeline";
import { SupabaseQueueStore } from "../../../workers/scan-worker/src/queue";
import { adminBaseUrl, type ApiUser, createHarness, type Harness, SEED } from "../src/harness";

let h: Harness, owner: ApiUser, peer: ApiUser, manager: ApiUser, other: ApiUser;
let org: string, display: string, version: string, jpeg: Buffer;
const logger = createLogger("api-test-worker", "error", () => undefined);
const post = (path: string, body: unknown, user: ApiUser, key = randomUUID()) =>
  h.api(path, { method: "POST", token: user.token, body, headers: { "idempotency-key": key } });
const patchCounts = (id: string, body: unknown, user: ApiUser, key = randomUUID()) =>
  h.api(`/api/v1/scans/${id}/counts`, { method: "PATCH", token: user.token, body, headers: { "idempotency-key": key } });
const detail = async (id: string) => {
  const r = await h.api(`/api/v1/scans/${id}`, { token: owner.token });
  expect(r.status, r.text).toBe(200);
  return r.json.data;
};
const corrections = async (id: string) => (await h.db.query(
  `select ss.slot_label_snapshot as label, c.actor_id, c.previous_quantity, c.corrected_quantity, c.original_ai_quantity, c.reason, c.scan_revision, c.verified
   from public.scan_corrections c join public.scan_slots ss on ss.id = c.scan_slot_id where c.scan_id = $1 order by c.created_at, ss.slot_label_snapshot`, [id])).rows;
const evidence = async (id: string) => (await h.db.query(
  "select slot_label_snapshot as label, ai_quantity, ai_confidence::float as confidence, ai_flags, review_required from public.scan_slots where scan_id = $1 order by slot_label_snapshot", [id])).rows;

async function queuedPhotoScan(): Promise<string> {
  const created = await post("/api/v1/scans", { display_id: display, source: "photo", expected_pog_version_id: version }, owner);
  expect(created.status, created.text).toBe(201);
  const id = created.json.data.scan.scan_id as string;
  const put = await fetch(`${adminBaseUrl()}/api/v1/scans/${id}/image`, { method: "PUT", headers: { authorization: `Bearer ${owner.token}` }, body: new Uint8Array(jpeg) });
  expect(put.status).toBe(200);
  const finalized = await post(`/api/v1/scans/${id}/finalize-upload`, { expected_revision: 1, crop: { x: 0, y: 0, width: 1, height: 1 } }, owner);
  expect(finalized.status, finalized.text).toBe(200);
  return id;
}

async function analyse(id: string, vision: VisionAdapter) {
  const queue = new SupabaseQueueStore(h.service);
  await h.db.query("update public.scan_jobs set available_at = now() where scan_id = $1 and state = 'queued'", [id]);
  const job = await queue.claim(attemptPolicy(vision));
  expect(job?.scan_id).toBe(id);
  return processJob({ queue, vision, logger }, job!);
}

beforeAll(async () => {
  h = await createHarness();
  org = randomUUID(); display = randomUUID(); version = randomUUID();
  const store = randomUUID(), product = randomUUID(), pog = randomUUID();
  await h.db.query("insert into public.organizations(id,name) values($1,'Review API synthetic')", [org]);
  await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'RAPI','RAPI','UTC')", [store, org]);
  owner = await h.user("review-owner", { org: { id: org, role: "member" }, stores: [{ id: store, role: "employee" }] });
  peer = await h.user("review-peer", { org: { id: org, role: "member" }, stores: [{ id: store, role: "employee" }] });
  manager = await h.user("review-manager", { org: { id: org, role: "member" }, stores: [{ id: store, role: "manager" }] });
  other = await h.user("review-other", { org: { id: SEED.orgB, role: "admin" } });
  const admin = await h.user("review-admin", { org: { id: org, role: "admin" } });
  await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Synthetic','Syn','fixture','tub')", [product, org]);
  await h.db.query("insert into public.pogs(id,organization_id,name) values($1,$2,'Review API')", [pog, org]);
  const referencePath = `${org}/${pog}/${version}/reference-fixture.jpg`;
  await h.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values($1,$2,$3,1,$4,400,100,now(),false)", [version, org, pog, referencePath]);
  await h.db.query(`insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order) values
    ($1,$2,'A1',$3,0,0,0.25,1,5,null,0),($1,$2,'A2',$3,0.25,0,0.25,1,5,2,1),($1,$2,'A3',$3,0.5,0,0.25,1,6,null,2),($1,$2,'A4',$3,0.75,0,0.25,1,8,null,3)`, [org, version, product]);
  const ref = await h.service.storage.from("pog-images").upload(referencePath, await sharp({ create: { width: 400, height: 100, channels: 3, background: "#224466" } }).jpeg().toBuffer(), { contentType: "image/jpeg", upsert: true });
  if (ref.error) throw ref.error;
  const published = await h.service.rpc("publish_pog_version", { p_actor: admin.id, p_version_id: version, p_expected_revision: 1 });
  if (published.error) throw published.error;
  await h.db.query("insert into public.displays(id,organization_id,store_id,name,active_pog_version_id) values($1,$2,$3,'Review API case',$4)", [display, org, store, version]);
  jpeg = await sharp({ create: { width: 400, height: 100, channels: 3, background: "#aa3322" } }).jpeg().toBuffer();
});

beforeEach(async () => {
  // Shared local database: park other organizations' due work so claims here only see this file's scans.
  await h.db.query("update public.scan_jobs j set available_at = now() + interval '1 day' from public.scans s where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'queued'", [org]);
  await h.db.query("update public.scan_jobs j set lease_until = now() + interval '1 day' from public.scans s where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'running'", [org]);
});

afterAll(() => h?.close());

it("routes uncertain estimates to review, records explicit acceptance and corrections without touching AI evidence, and freezes on confirmation", async () => {
  const id = await queuedPhotoScan();
  expect(await analyse(id, new MockVisionAdapter("review"))).toEqual({ status: "committed" });
  const reviewed = await detail(id);
  const slot = Object.fromEntries(reviewed.slots.map((s: any) => [s.slot_label, s.slot_id])) as Record<string, string>;
  // Low confidence, wrong-product flag and null confidence need review; a high-confidence estimate does not.
  expect(reviewed.slots.map((s: any) => [s.slot_label, s.ai_quantity, s.confidence, s.flags, s.accepted_quantity, s.review_required, s.review_state])).toEqual([
    ["A1", 3, 0.62, [], 3, true, "pending"], ["A2", 2, 0.91, ["wrong_product"], 2, true, "pending"],
    ["A3", 4, null, [], 4, true, "pending"], ["A4", 5, 0.97, [], 5, false, "pending"]]);
  expect(reviewed.unresolved_slot_ids).toEqual([slot.A1, slot.A2, slot.A3]);
  const before = await evidence(id);
  let revision = reviewed.revision as number;

  // Known-but-unverified estimates give a labeled provisional recommendation, never a confirmable one.
  expect(reviewed.provisional).toBe(true);
  const blocked = await post(`/api/v1/scans/${id}/confirm`, { expected_revision: revision }, owner);
  expect(blocked.status).toBe(422);
  expect(blocked.json.error.code).toBe("UNRESOLVED_COUNTS");
  expect([...blocked.json.error.field_errors.slot_ids].sort()).toEqual([slot.A1, slot.A2, slot.A3].sort());

  // An unverified re-save of the same number is recorded as unverified and resolves nothing.
  const unverified = await patchCounts(id, { expected_revision: revision, items: [{ slot_id: slot.A2, quantity: 2, verified: false, reason: null }] }, owner);
  expect(unverified.status, unverified.text).toBe(200);
  expect(unverified.json.data.revision).toBe(++revision);
  expect(unverified.json.data.unresolved_slot_ids).toContain(slot.A2);

  // Accepting an unchanged estimate (delta zero) and correcting another commit together.
  const saved = await patchCounts(id, { expected_revision: revision, items: [
    { slot_id: slot.A1, quantity: 3, verified: true, reason: "visibility_check" },
    { slot_id: slot.A2, quantity: 1, verified: true, reason: "wrong_product" }] }, owner);
  expect(saved.status, saved.text).toBe(200);
  const afterSave = saved.json.data;
  expect(afterSave.revision).toBe(++revision);
  expect(afterSave.unresolved_slot_ids).toEqual([slot.A3]);
  expect(afterSave.slots.map((s: any) => [s.slot_label, s.ai_quantity, s.accepted_quantity, s.review_state])).toEqual([
    ["A1", 3, 3, "verified"], ["A2", 2, 1, "verified"], ["A3", 4, 4, "pending"], ["A4", 5, 5, "pending"]]);
  // The backend recalculates; the client sends no arithmetic.
  const expected = calculateRefill(afterSave.slots.map((s: any) => ({ slot_id: s.slot_id, product_id: s.product_id, target: s.target, threshold: s.refill_threshold, current: s.accepted_quantity })));
  expect(afterSave.slots.map((s: any) => s.refill_quantity)).toEqual(expected.slots.map((s) => s.refill_quantity));
  expect(afterSave.slots.map((s: any) => s.refill_quantity)).toEqual([2, 4, 2, 3]);
  expect(afterSave.provisional_total_refill).toBe(11);
  expect(afterSave.total_refill).toBeNull();
  expect(await evidence(id)).toEqual(before);
  expect(await corrections(id)).toEqual([
    { label: "A2", actor_id: owner.id, previous_quantity: 2, corrected_quantity: 2, original_ai_quantity: 2, reason: null, scan_revision: revision - 1, verified: false },
    { label: "A1", actor_id: owner.id, previous_quantity: 3, corrected_quantity: 3, original_ai_quantity: 3, reason: "visibility_check", scan_revision: revision, verified: true },
    { label: "A2", actor_id: owner.id, previous_quantity: 2, corrected_quantity: 1, original_ai_quantity: 2, reason: "wrong_product", scan_revision: revision, verified: true },
  ]);

  // Authorization: another employee may read but not correct; other organizations see nothing.
  const item = { slot_id: slot.A3, quantity: 4, verified: true, reason: "visibility_check" };
  expect((await patchCounts(id, { expected_revision: revision, items: [item] }, peer)).status).toBe(403);
  expect((await patchCounts(id, { expected_revision: revision, items: [item] }, other)).status).toBe(404);
  expect((await h.api(`/api/v1/scans/${id}/counts`, { method: "PATCH", body: { expected_revision: revision, items: [item] }, headers: { "idempotency-key": randomUUID() } })).status).toBe(403);
  // Clients cannot submit AI fields or refill arithmetic.
  expect((await patchCounts(id, { expected_revision: revision, items: [{ ...item, ai_quantity: 9 }] }, owner)).status).toBe(422);
  expect((await patchCounts(id, { expected_revision: revision, items: [item], total_refill: 0 }, owner)).status).toBe(422);

  // Two devices saving the same revision: exactly one wins; the loser changes nothing.
  const [first, second] = await Promise.all([
    patchCounts(id, { expected_revision: revision, items: [item] }, owner),
    patchCounts(id, { expected_revision: revision, items: [{ ...item, quantity: 6, reason: "count_corrected" }] }, manager),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  const winner = first.status === 200 ? first : second;
  expect(winner.json.data.revision).toBe(++revision);
  expect((await corrections(id)).filter((c) => c.label === "A3")).toHaveLength(1);
  const stale = await patchCounts(id, { expected_revision: revision - 1, items: [{ ...item, quantity: 0 }] }, owner);
  expect(stale.status).toBe(409);
  expect((await detail(id)).revision).toBe(revision);

  const confirmed = await post(`/api/v1/scans/${id}/confirm`, { expected_revision: revision }, owner);
  expect(confirmed.status, confirmed.text).toBe(200);
  expect(confirmed.json.data).toMatchObject({ status: "confirmed", provisional: false, unresolved_slot_ids: [] });
  revision = confirmed.json.data.revision;
  const frozen = await corrections(id);

  // Confirmed scans reject further correction, takeover and retry; evidence and history are unchanged.
  expect((await patchCounts(id, { expected_revision: revision, items: [{ ...item, quantity: 0 }] }, owner)).status).toBe(409);
  expect((await patchCounts(id, { expected_revision: revision, items: [{ ...item, quantity: 0 }] }, manager)).status).toBe(409);
  expect((await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: revision }, owner)).status).toBe(409);
  expect(await corrections(id)).toEqual(frozen);
  expect(await evidence(id)).toEqual(before);
  expect((await detail(id)).revision).toBe(revision);
  await expect(h.db.query("update public.scan_slots set accepted_quantity = 0 where scan_id = $1", [id])).rejects.toThrow(/IMMUTABLE/);

  // A mistake is corrected with a new scan of the same display; the confirmed one stays as evidence.
  const fresh = await post("/api/v1/scans", { display_id: display, source: "manual", expected_pog_version_id: version }, owner);
  expect(fresh.status, fresh.text).toBe(201);
  expect(fresh.json.data.scan_id).not.toBe(id);
  expect((await detail(id)).status).toBe("confirmed");
});

it("the database keeps AI evidence and required review even for privileged writers once review starts", async () => {
  const id = await queuedPhotoScan();
  expect(await analyse(id, new MockVisionAdapter("review"))).toEqual({ status: "committed" });
  await expect(h.db.query("update public.scan_slots set ai_quantity = 9 where scan_id = $1 and slot_label_snapshot = 'A1'", [id])).rejects.toThrow(/IMMUTABLE/);
  await expect(h.db.query("update public.scan_slots set review_required = false where scan_id = $1 and slot_label_snapshot = 'A1'", [id])).rejects.toThrow(/IMMUTABLE/);
  const saved = await patchCounts(id, { expected_revision: (await detail(id)).revision, items: [{ slot_id: (await detail(id)).slots[0].slot_id, quantity: 4, verified: true, reason: "count_corrected" }] }, owner);
  expect(saved.status, saved.text).toBe(200);
  await expect(h.db.query("update public.scan_corrections set corrected_quantity = 0 where scan_id = $1", [id])).rejects.toThrow();
  await expect(h.db.query("delete from public.scan_corrections where scan_id = $1", [id])).rejects.toThrow();
  // Requiring review is still allowed (manual takeover relies on it).
  await expect(h.db.query("update public.scan_slots set review_required = true where scan_id = $1 and slot_label_snapshot = 'A4'", [id])).resolves.toBeDefined();
});

it("failed analysis can be taken over as a manual check on the same scan", async () => {
  const id = await queuedPhotoScan();
  expect(await analyse(id, { provider: "scripted", model: "s1", analyze: async () => { throw new VisionProviderError("permanent", "PROVIDER_CONFIGURATION"); } }))
    .toEqual({ status: "failed", failure_code: "PROVIDER_CONFIGURATION" });
  const failed = await detail(id);
  expect((await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: failed.revision }, peer)).status).toBe(403);
  const key = randomUUID();
  const taken = await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: failed.revision }, owner, key);
  expect(taken.status, taken.text).toBe(200);
  expect(taken.json.data).toMatchObject({ status: "needs_review", source: "manual", image_available: true });
  expect(taken.json.data.analysis.failure_code).toBeNull();
  expect(taken.json.data.slots.every((s: any) => s.accepted_quantity === null && s.review_required && s.review_state === "pending")).toBe(true);
  const replay = await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: failed.revision }, owner, key);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect((await post(`/api/v1/scans/${id}/retry`, { expected_revision: taken.json.data.revision }, owner)).status).toBe(409);
});
