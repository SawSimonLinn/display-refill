// Feature 09 over HTTP: polling state, explicit retry and manual takeover,
// with the real worker pipeline run in-process against LOCAL Supabase.
import { randomUUID } from "node:crypto";
import { createLogger, MockVisionAdapter, type VisionAdapter, VisionProviderError } from "@display-refill/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { attemptPolicy, processJob } from "../../../workers/scan-worker/src/pipeline";
import { SupabaseQueueStore } from "../../../workers/scan-worker/src/queue";
import { adminBaseUrl, type ApiUser, createHarness, type Harness, SEED } from "../src/harness";

let h: Harness, owner: ApiUser, peer: ApiUser, manager: ApiUser, other: ApiUser;
let org: string, display: string, version: string, jpeg: Buffer;
const logger = createLogger("api-test-worker", "error", () => undefined);
const post = (path: string, body: unknown, user: ApiUser, key: string | null = randomUUID()) =>
  h.api(path, { method: "POST", token: user.token, body, headers: key ? { "idempotency-key": key } : {} });
const detail = async (id: string, user = owner) => {
  const r = await h.api(`/api/v1/scans/${id}`, { token: user.token });
  expect(r.status, r.text).toBe(200);
  return r.json.data;
};

async function queuedPhotoScan(): Promise<string> {
  const created = await post("/api/v1/scans", { display_id: display, source: "photo", expected_pog_version_id: version }, owner);
  expect(created.status, created.text).toBe(201);
  expect(created.json.data.analysis_available).toBe(true);
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
  await h.db.query("insert into public.organizations(id,name) values($1,'Vision API synthetic')", [org]);
  await h.db.query("insert into public.stores(id,organization_id,name,store_number,timezone) values($1,$2,'VAPI','VAPI','UTC')", [store, org]);
  owner = await h.user("vision-owner", { org: { id: org, role: "member" }, stores: [{ id: store, role: "employee" }] });
  peer = await h.user("vision-peer", { org: { id: org, role: "member" }, stores: [{ id: store, role: "employee" }] });
  manager = await h.user("vision-manager", { org: { id: org, role: "member" }, stores: [{ id: store, role: "manager" }] });
  other = await h.user("vision-other", { org: { id: SEED.orgB, role: "admin" } });
  const admin = await h.user("vision-admin", { org: { id: org, role: "admin" } });
  await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Synthetic','Syn','fixture','tub')", [product, org]);
  await h.db.query("insert into public.pogs(id,organization_id,name) values($1,$2,'Vision API')", [pog, org]);
  const referencePath = `${org}/${pog}/${version}/reference-fixture.jpg`;
  await h.db.query("insert into public.pog_versions(id,organization_id,pog_id,version_number,reference_path,reference_width,reference_height,reference_validated_at,slots_need_review) values($1,$2,$3,1,$4,400,200,now(),false)", [version, org, pog, referencePath]);
  await h.db.query("insert into public.pog_slots(organization_id,pog_version_id,label,product_id,x,y,width,height,target_quantity,refill_threshold,sort_order) values($1,$2,'A1',$3,0,0,0.5,1,5,null,0),($1,$2,'A2',$3,0.5,0,0.5,1,5,null,1)", [org, version, product]);
  const ref = await h.service.storage.from("pog-images").upload(referencePath, await sharp({ create: { width: 400, height: 200, channels: 3, background: "#224466" } }).jpeg().toBuffer(), { contentType: "image/jpeg", upsert: true });
  if (ref.error) throw ref.error;
  const published = await h.service.rpc("publish_pog_version", { p_actor: admin.id, p_version_id: version, p_expected_revision: 1 });
  if (published.error) throw published.error;
  await h.db.query("insert into public.displays(id,organization_id,store_id,name,active_pog_version_id) values($1,$2,$3,'Vision API case',$4)", [display, org, store, version]);
  jpeg = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#aa3322" } }).jpeg().toBuffer();
});

beforeEach(async () => {
  // Shared local database: park other organizations' due work so claims here only see this file's scans.
  await h.db.query("update public.scan_jobs j set available_at = now() + interval '1 day' from public.scans s where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'queued'", [org]);
  await h.db.query("update public.scan_jobs j set lease_until = now() + interval '1 day' from public.scans s where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'running'", [org]);
});

afterAll(() => h?.close());

it("exposes queued → needs_review polling state; synthetic mock evidence is labeled and unknowns stay null", async () => {
  const id = await queuedPhotoScan();
  const queued = await detail(id);
  expect(queued).toMatchObject({ status: "queued", revision: 2, provisional_total_refill: null });
  expect(queued.analysis).toEqual({ generation: 0, failure_code: null, retry_available: false, retries_remaining: 2, alignment: null, image_flags: [], provider: null, synthetic: false, manual_takeover_at: null });
  expect(await analyse(id, new MockVisionAdapter("mixed"))).toEqual({ status: "committed" });
  const reviewed = await detail(id);
  expect(reviewed).toMatchObject({ status: "needs_review", revision: 4, provisional: true, provisional_total_refill: null, total_refill: null });
  expect(reviewed.analysis).toMatchObject({ alignment: "good", provider: "mock", synthetic: true, failure_code: null });
  expect(reviewed.slots.map((s: any) => [s.slot_label, s.ai_quantity, s.accepted_quantity, s.review_required, s.flags])).toEqual([
    ["A1", 1, 1, false, []], ["A2", null, null, true, ["occluded"]]]);
  expect(reviewed.unresolved_slot_ids).toEqual([reviewed.slots[1].slot_id]);
  // Peers in the store can poll; other organizations cannot see it.
  expect((await h.api(`/api/v1/scans/${id}`, { token: peer.token })).status).toBe(200);
  expect((await h.api(`/api/v1/scans/${id}`, { token: other.token })).status).toBe(404);
  expect((await h.api(`/api/v1/scans/${id}`)).status).toBe(401);
  // AI evidence cannot be supplied or replaced by clients; review continues through Feature 06 counts.
  const counts = await h.api(`/api/v1/scans/${id}/counts`, { method: "PATCH", token: owner.token, headers: { "idempotency-key": randomUUID() },
    body: { expected_revision: 4, items: [{ slot_id: reviewed.slots[1].slot_id, quantity: 2, verified: true, reason: "visibility_check" }] } });
  expect(counts.status, counts.text).toBe(200);
  expect(counts.json.data.slots[1]).toMatchObject({ ai_quantity: null, accepted_quantity: 2, review_state: "verified" });
  expect((await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: 5 }, owner)).status).toBe(409);
});

it("failed analysis offers bounded explicit retry to authorized actors only", async () => {
  const id = await queuedPhotoScan();
  expect(await analyse(id, { provider: "scripted", model: "s1", analyze: async () => { throw new VisionProviderError("permanent", "PROVIDER_CONFIGURATION"); } }))
    .toEqual({ status: "failed", failure_code: "PROVIDER_CONFIGURATION" });
  const failed = await detail(id);
  expect(failed).toMatchObject({ status: "failed", revision: 4 });
  expect(failed.analysis).toMatchObject({ failure_code: "PROVIDER_CONFIGURATION", retry_available: true, retries_remaining: 2 });
  expect((await post(`/api/v1/scans/${id}/retry`, { expected_revision: 4 }, peer)).status).toBe(403);
  expect((await post(`/api/v1/scans/${id}/retry`, { expected_revision: 4 }, other)).status).toBe(404);
  expect((await h.api(`/api/v1/scans/${id}/retry`, { method: "POST", token: "forged.invalid.token", body: { expected_revision: 4 }, headers: { "idempotency-key": randomUUID() } })).status).toBe(401);
  // No bearer and no same-origin cookie session: refused before any state change.
  expect((await h.api(`/api/v1/scans/${id}/retry`, { method: "POST", body: { expected_revision: 4 }, headers: { "idempotency-key": randomUUID() } })).status).toBe(403);
  expect((await post(`/api/v1/scans/${id}/retry`, { expected_revision: 4 }, owner, null)).status).toBe(422);
  expect((await post(`/api/v1/scans/${id}/retry`, { expected_revision: 4, generation: 9 }, owner)).status).toBe(422);
  expect((await post(`/api/v1/scans/${id}/retry`, { expected_revision: 3 }, owner)).status).toBe(409);
  const key = randomUUID();
  const retried = await post(`/api/v1/scans/${id}/retry`, { expected_revision: 4 }, owner, key);
  expect(retried.status, retried.text).toBe(200);
  expect(retried.json.data).toMatchObject({ status: "queued", revision: 5 });
  expect(retried.json.data.analysis).toMatchObject({ generation: 1, failure_code: null, retry_available: false, retries_remaining: 1 });
  const replay = await post(`/api/v1/scans/${id}/retry`, { expected_revision: 4 }, owner, key);
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect((await h.db.query("select generation, state from public.scan_jobs where scan_id = $1 order by generation", [id])).rows)
    .toEqual([{ generation: 0, state: "failed" }, { generation: 1, state: "queued" }]);
  expect(await analyse(id, new MockVisionAdapter("poor_alignment"))).toEqual({ status: "committed" });
  const poor = await detail(id);
  expect(poor.analysis.alignment).toBe("poor");
  expect(poor.slots.every((s: any) => s.ai_quantity === null && s.review_required)).toBe(true);
});

it("manual takeover from queued fences the worker, keeps the photo and continues as a manual check", async () => {
  const id = await queuedPhotoScan();
  expect((await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: 2 }, peer)).status).toBe(403);
  const taken = await post(`/api/v1/scans/${id}/manual-takeover`, { expected_revision: 2 }, manager);
  expect(taken.status, taken.text).toBe(200);
  expect(taken.json.data).toMatchObject({ status: "needs_review", source: "manual", revision: 3, image_available: true });
  expect(taken.json.data.analysis).toMatchObject({ generation: 1, retry_available: false });
  expect(Date.parse(taken.json.data.analysis.manual_takeover_at)).toBeGreaterThan(0);
  expect(await new SupabaseQueueStore(h.service).claim(attemptPolicy(new MockVisionAdapter()))).toBeNull();
  expect((await h.api(`/api/v1/scans/${id}/image`, { token: owner.token })).status).toBe(200);
  const items = taken.json.data.slots.map((s: any) => ({ slot_id: s.slot_id, quantity: 3, verified: true, reason: "manual_count" }));
  expect((await h.api(`/api/v1/scans/${id}/counts`, { method: "PATCH", token: owner.token, headers: { "idempotency-key": randomUUID() }, body: { expected_revision: 3, items } })).status).toBe(200);
  const confirmed = await post(`/api/v1/scans/${id}/confirm`, { expected_revision: 4 }, owner);
  expect(confirmed.status, confirmed.text).toBe(200);
  expect(confirmed.json.data).toMatchObject({ status: "confirmed", total_refill: 4 });
});
