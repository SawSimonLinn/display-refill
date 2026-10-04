// Feature 09: durable queue, leases, fencing, budgets and takeover against the
// LOCAL database and private Storage, driving the real worker pipeline.
import { randomUUID } from "node:crypto";
import {
  createLogger, finalizeScanPhoto, MockVisionAdapter, type MockVisionScenario, type VisionAdapter, VisionProviderError,
} from "@display-refill/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attemptPolicy, processJob } from "../../../workers/scan-worker/src/pipeline";
import { type ClaimedJob, SupabaseQueueStore } from "../../../workers/scan-worker/src/queue";
import { SEED } from "../src/seed-ids";
import { createWorld, type TestUser } from "../src/world";

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;
let queue: SupabaseQueueStore;
let org: string, storeA: string, storeB: string, displayA: string, displayB: string, version: string;
let peer: TestUser, manager: TestUser, outsider: TestUser;
// Feature 08 allows ten new photo scans per actor per minute, so creators rotate.
const creators: TestUser[] = [];
const owners = new Map<string, TestUser>();
const owner = (scan: string) => owners.get(scan)!;
let nextCreator = 0;
let photo: Buffer;
const SECRET = "sk-live-SENTINEL-feature09";
const logLines: string[] = [];
const logger = createLogger("scan-worker-test", "debug", (_level, line) => logLines.push(line));

const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await w.db.query(sql, params)).rows as T[];
const scanRow = async (id: string) => (await q("select * from public.scans where id = $1", [id]))[0]!;
const jobRows = async (id: string) => q("select * from public.scan_jobs where scan_id = $1 order by generation", [id]);
const attempts = async (id: string) => q("select * from public.scan_attempts where scan_id = $1 order by generation, attempt_number", [id]);
const slots = async (id: string) => q("select * from public.scan_slots where scan_id = $1 order by slot_label_snapshot", [id]);

function scripted(analyze: VisionAdapter["analyze"], model = "scripted-v1"): VisionAdapter {
  return { provider: "scripted", model, analyze };
}
const mock = (scenario: MockVisionScenario) => new MockVisionAdapter(scenario);

/** Real Feature 08 path: create, stage bytes, server finalization → queued with one job. */
async function createPhotoScan(display = displayA): Promise<string> {
  const actor = creators[nextCreator++ % creators.length]!;
  const created = await w.service.rpc("photo_scan_workflow", {
    p_actor: actor.id, p_action: "create", p_resource: display, p_input: { expected_pog_version_id: version }, p_key: randomUUID(),
  });
  if (created.error) throw created.error;
  const id = (created.data as any).payload.scan.id as string;
  owners.set(id, actor);
  return id;
}

async function queuedScan(display = displayA): Promise<string> {
  const id = await createPhotoScan(display);
  const actor = owner(id);
  return finalize(id, actor);
}

async function finalize(id: string, actor: TestUser): Promise<string> {
  const intent = (await q("select object_path from public.upload_intents where resource_id = $1", [id]))[0]!;
  const staged = await w.service.storage.from("display-scans").upload(intent.object_path, photo, { contentType: "image/jpeg" });
  if (staged.error) throw staged.error;
  const finalized = await finalizeScanPhoto(w.service, actor.id, id, { expected_revision: 1, crop: { x: 0, y: 0, width: 1, height: 1 } }, randomUUID(), randomUUID());
  if (!finalized.ok) throw new Error(`finalize failed: ${finalized.code}`);
  return id;
}

/** Makes this scan's job due now and claims it; every other job of this run is parked by beforeEach. */
async function claimFor(scanId: string, vision: VisionAdapter): Promise<ClaimedJob> {
  await q("update public.scan_jobs set available_at = now() where scan_id = $1 and state = 'queued'", [scanId]);
  const job = await queue.claim(attemptPolicy(vision));
  if (job?.scan_id !== scanId) throw new Error(`expected to claim ${scanId}, got ${job?.scan_id ?? "nothing"}`);
  return job;
}

async function runOnce(scanId: string, vision: VisionAdapter, timing?: { providerTimeoutMs?: number; heartbeatMs?: number }) {
  return processJob({ queue, vision, logger, timing }, await claimFor(scanId, vision));
}

const takeover = (actor: TestUser, scan: string, revision: number, key = randomUUID()) =>
  w.service.rpc("scan_analysis_action", { p_actor: actor.id, p_action: "takeover", p_scan: scan, p_expected_revision: revision, p_key: key });
const retry = (actor: TestUser, scan: string, revision: number, key = randomUUID()) =>
  w.service.rpc("scan_analysis_action", { p_actor: actor.id, p_action: "retry", p_scan: scan, p_expected_revision: revision, p_key: key });

beforeAll(async () => {
  w = await createWorld();
  queue = new SupabaseQueueStore(w.service);
  org = randomUUID(); storeA = randomUUID(); storeB = randomUUID(); displayA = randomUUID(); displayB = randomUUID(); version = randomUUID();
  const product = randomUUID(), pog = randomUUID();
  await q("insert into public.organizations(id, name) values ($1, 'Vision synthetic')", [org]);
  await q("insert into public.stores(id, organization_id, name, store_number, timezone) values ($1, $3, 'VA', 'VA', 'UTC'), ($2, $3, 'VB', 'VB', 'UTC')", [storeA, storeB, org]);
  for (let i = 0; i < 4; i++) {
    creators.push(await w.user(`vision-employee-${i}`, { org: { id: org, role: "member" }, stores: [{ id: storeA, role: "employee" }, { id: storeB, role: "employee" }] }));
  }
  peer = await w.user("vision-peer", { org: { id: org, role: "member" }, stores: [{ id: storeA, role: "employee" }] });
  manager = await w.user("vision-manager", { org: { id: org, role: "member" }, stores: [{ id: storeA, role: "manager" }] });
  outsider = await w.user("vision-outsider", { org: { id: SEED.orgB, role: "admin" } });
  const admin = await w.user("vision-admin", { org: { id: org, role: "admin" } });
  await q("insert into public.products(id, organization_id, name, short_name, category, container_type) values ($1, $2, 'Synthetic dip', 'Dip', 'fixture', 'tub')", [product, org]);
  await q("insert into public.pogs(id, organization_id, name) values ($1, $2, 'Vision synthetic')", [pog, org]);
  const referencePath = `${org}/${pog}/${version}/reference-fixture.jpg`;
  await q(`insert into public.pog_versions(id, organization_id, pog_id, version_number, reference_path, reference_width, reference_height, reference_validated_at, slots_need_review)
           values ($1, $2, $3, 1, $4, 300, 100, now(), false)`, [version, org, pog, referencePath]);
  for (const [i, label] of ["A1", "A2", "A3"].entries()) {
    await q(`insert into public.pog_slots(organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity, refill_threshold, sort_order)
             values ($1, $2, $3, $4, $5, 0, 0.333333, 1, 4, 1, $6)`, [org, version, label, product, i * 0.333333, i]);
  }
  const reference = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#225588" } }).jpeg().toBuffer();
  const up = await w.service.storage.from("pog-images").upload(referencePath, reference, { contentType: "image/jpeg", upsert: true });
  if (up.error) throw up.error;
  const published = await w.service.rpc("publish_pog_version", { p_actor: admin.id, p_version_id: version, p_expected_revision: 1 });
  if (published.error) throw published.error;
  await q("insert into public.displays(id, organization_id, store_id, name, active_pog_version_id) values ($1, $3, $4, 'VA case', $5), ($2, $3, $6, 'VB case', $5)",
    [displayA, displayB, org, storeA, version, storeB]);
  photo = await sharp({ create: { width: 600, height: 200, channels: 3, background: "#aa3322" } }).withMetadata({ orientation: 1 }).jpeg().toBuffer();
});

beforeEach(async () => {
  // The local database is shared with other suites; park leftover due work from
  // other organizations so claims in this file only see this run's scans.
  await q(`update public.scan_jobs j set available_at = now() + interval '1 day' from public.scans s
           where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'queued'`, [org]);
  await q(`update public.scan_jobs j set lease_until = now() + interval '1 day' from public.scans s
           where s.id = j.scan_id and s.organization_id <> $1 and j.state = 'running'`, [org]);
  // Keep each test's own jobs from consuming the per-store capacity of the next one.
  await q(`update public.scan_jobs j set state = 'cancelled', lease_token = null, lease_until = null from public.scans s
           where s.id = j.scan_id and s.organization_id = $1 and j.state in ('queued', 'running')`, [org]);
});

afterAll(async () => w?.close());

describe("mock responses produce the correct review state", () => {
  it("good output commits detections, attempt evidence and needs_review in one transaction", async () => {
    const id = await queuedScan();
    expect((await scanRow(id)).revision).toBe(2);
    expect(await runOnce(id, mock("good"))).toEqual({ status: "committed" });
    const s = await scanRow(id);
    expect(s).toMatchObject({ status: "needs_review", revision: 4, failure_code: null, source: "photo" });
    expect(s.ai_summary).toMatchObject({ alignment: "good", image_flags: [], provider: "mock", model: "mock-fixture-good-v1",
      prompt_version: "count-v1", schema_version: 1, policy_version: "review-v1", confidence_threshold: 0.8, generation: 0, attempt_number: 1 });
    const rows = await slots(id);
    expect(rows.map((r) => [r.ai_quantity, Number(r.ai_confidence), r.accepted_quantity, r.review_required, r.review_state]))
      .toEqual([[1, 0.93, 1, false, "pending"], [2, 0.93, 2, false, "pending"], [3, 0.93, 3, false, "pending"]]);
    const [a] = await attempts(id);
    expect(a).toMatchObject({ provider: "mock", model: "mock-fixture-good-v1", prompt_version: "count-v1", schema_version: 1, policy_version: "review-v1",
      outcome: "succeeded", error_code: null, generation: 0, attempt_number: 1, input_width: 600, input_height: 200 });
    expect(Number(a!.confidence_threshold)).toBe(0.8);
    expect(a!.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a!.usage_json).toEqual({ input_tokens: 0, output_tokens: 0, image_count: 2 });
    expect(a!.normalized_response.slots).toHaveLength(3);
    expect((await jobRows(id))[0]).toMatchObject({ state: "succeeded", attempt_count: 1, lease_token: null });
    expect(await q("select 1 from public.audit_events where resource_id = $1 and event_type = 'scan.analysis_completed'", [id])).toHaveLength(1);
    // Clients read observations through RLS, never jobs or attempts.
    const own = await owner(id).client.from("scans").select("status, ai_summary, scan_slots(ai_quantity)").eq("id", id).single();
    expect(own.data?.status).toBe("needs_review");
    // Jobs and attempts have no client grant at all (permission denied, no rows).
    for (const table of ["scan_attempts", "scan_jobs"] as const) {
      const denied = await owner(id).client.from(table).select("id").eq("scan_id", id);
      expect(denied.data).toBeNull();
      expect(denied.error?.code).toBe("42501");
    }
    expect((await outsider.client.from("scans").select("id").eq("id", id)).data).toEqual([]);
  });

  it("poor alignment forces every count unknown with required review", async () => {
    const id = await queuedScan();
    await runOnce(id, mock("poor_alignment"));
    expect((await scanRow(id)).ai_summary.alignment).toBe("poor");
    expect((await slots(id)).every((r) => r.ai_quantity === null && r.accepted_quantity === null && r.review_required)).toBe(true);
  });

  it("occlusion keeps the slot unknown and an image flag requires review everywhere", async () => {
    const id = await queuedScan();
    await runOnce(id, mock("occluded"));
    const rows = await slots(id);
    expect(rows[0]).toMatchObject({ ai_quantity: null, ai_flags: ["occluded"], review_required: true });
    expect(rows.slice(1).map((r) => [r.ai_quantity, r.review_required])).toEqual([[1, true], [1, true]]);
    expect((await scanRow(id)).ai_summary.image_flags).toEqual(["occluded"]);
  });

  it("a missing slot becomes unknown/ambiguous, never zero", async () => {
    const id = await queuedScan();
    await runOnce(id, mock("missing_slot"));
    const rows = await slots(id);
    expect(rows[0]).toMatchObject({ ai_quantity: null, ai_confidence: null, ai_flags: ["ambiguous"], accepted_quantity: null, review_required: true });
    expect(rows.slice(1).map((r) => r.ai_quantity)).toEqual([1, 1]);
  });

  it("schema-invalid output gets exactly one retry inside the budget, then fails", async () => {
    const id = await queuedScan();
    expect(await runOnce(id, mock("invalid"))).toMatchObject({ status: "requeued" });
    expect((await scanRow(id)).status).toBe("queued");
    expect(await runOnce(id, mock("invalid"))).toEqual({ status: "failed", failure_code: "INVALID_OUTPUT" });
    expect(await scanRow(id)).toMatchObject({ status: "failed", failure_code: "INVALID_OUTPUT" });
    expect((await attempts(id)).map((a) => [a.outcome, a.error_code])).toEqual([["invalid_output", "INVALID_OUTPUT"], ["invalid_output", "INVALID_OUTPUT"]]);
    expect((await slots(id)).every((r) => r.ai_quantity === null && r.accepted_quantity === null)).toBe(true);
  });

  it("wrong or duplicate slot IDs are never accepted", async () => {
    const id = await queuedScan();
    await runOnce(id, mock("duplicate_ids"));
    await runOnce(id, mock("unknown_id"));
    expect(await scanRow(id)).toMatchObject({ status: "failed", failure_code: "INVALID_SLOT_IDS" });
    expect((await slots(id)).every((r) => r.ai_quantity === null && r.ai_flags.length === 0)).toBe(true);
  });

  it("the database recomputes review routing and refuses inconsistent normalized results", async () => {
    const id = await queuedScan();
    const job = await claimFor(id, mock("good"));
    const pinned = job.slots.map((s) => s.slot_id);
    const finish = (result: unknown) => w.service.rpc("finish_scan_attempt", { p_job: job.job_id, p_lease: job.lease_token, p_outcome: "succeeded", p_result: result as any });
    const base = { schema_version: 1, alignment: "good", image_flags: [] };
    const slot = (slot_id: string, quantity: number | null, confidence: number | null) => ({ slot_id, quantity, confidence, flags: [], review_required: false });
    expect((await finish({ ...base, slots: pinned.slice(1).map((s) => slot(s, 1, 0.9)) })).error?.message).toBe("VALIDATION_FAILED");
    expect((await finish({ ...base, alignment: "poor", slots: pinned.map((s) => slot(s, 1, 0.9)) })).error?.message).toBe("VALIDATION_FAILED");
    expect((await finish({ ...base, slots: [...pinned.slice(1), randomUUID()].map((s) => slot(s, 1, 0.9)) })).error?.message).toBe("VALIDATION_FAILED");
    expect((await finish({ ...base, slots: pinned.map((s) => ({ ...slot(s, 1, 0.9), refill: 2 })) })).error?.message).toBe("VALIDATION_FAILED");
    // Supplied review_required=false is ignored: low confidence still routes to review.
    expect((await finish({ ...base, slots: pinned.map((s) => slot(s, 2, 0.5)) })).data).toEqual({ status: "committed" });
    expect((await slots(id)).every((r) => r.review_required)).toBe(true);
  });
});

describe("retry budget", () => {
  const fail = (error: Error) => scripted(async () => { throw error; });

  it("retryable errors back off 5 s, then 20 s or a longer Retry-After, and fail after three attempts", async () => {
    const id = await queuedScan();
    expect(await runOnce(id, fail(new VisionProviderError("retryable", "PROVIDER_UNAVAILABLE")))).toMatchObject({ status: "requeued" });
    let [job] = await jobRows(id);
    let delay = (Date.parse(job!.available_at) - Date.now()) / 1000;
    expect(delay).toBeGreaterThan(3.5);
    expect(delay).toBeLessThan(6.5);
    expect(await scanRow(id)).toMatchObject({ status: "queued", failure_code: null });
    expect(await runOnce(id, fail(new VisionProviderError("retryable", "PROVIDER_RATE_LIMITED", 120)))).toMatchObject({ status: "requeued" });
    [job] = await jobRows(id);
    delay = (Date.parse(job!.available_at) - Date.now()) / 1000;
    expect(delay).toBeGreaterThan(118);
    expect(delay).toBeLessThan(121);
    expect(job!.last_error_code).toBe("PROVIDER_RATE_LIMITED");
    // Third attempt: a provider that never answers hits the deadline; the budget is spent.
    expect(await runOnce(id, scripted(() => new Promise(() => {})), { providerTimeoutMs: 50 })).toEqual({ status: "failed", failure_code: "PROVIDER_TIMEOUT" });
    expect(await scanRow(id)).toMatchObject({ status: "failed", failure_code: "PROVIDER_TIMEOUT" });
    expect((await attempts(id)).map((a) => [a.attempt_number, a.outcome, a.error_code])).toEqual([
      [1, "provider_error", "PROVIDER_UNAVAILABLE"], [2, "provider_error", "PROVIDER_RATE_LIMITED"], [3, "timeout", "PROVIDER_TIMEOUT"]]);
    expect((await jobRows(id))[0]).toMatchObject({ state: "failed", attempt_count: 3 });
    expect(await q("select 1 from public.audit_events where resource_id = $1 and event_type = 'scan.analysis_failed'", [id])).toHaveLength(1);
  });

  it("an extreme Retry-After is capped at five minutes", async () => {
    const id = await queuedScan();
    await runOnce(id, fail(new VisionProviderError("retryable", "PROVIDER_RATE_LIMITED", 86_400)));
    const delay = (Date.parse((await jobRows(id))[0]!.available_at) - Date.now()) / 1000;
    expect(delay).toBeGreaterThan(298);
    expect(delay).toBeLessThan(301);
  });

  it("authorization/configuration failures are not retried", async () => {
    const id = await queuedScan();
    expect(await runOnce(id, fail(new VisionProviderError("permanent", "PROVIDER_CONFIGURATION")))).toEqual({ status: "failed", failure_code: "PROVIDER_CONFIGURATION" });
    expect((await jobRows(id))[0]).toMatchObject({ state: "failed", attempt_count: 1 });
  });

  it("provider secrets and messages never reach attempts, audit or logs", async () => {
    const id = await queuedScan();
    await runOnce(id, scripted(async () => { throw new Error(`401 for key ${SECRET} at https://signed.example/object?token=abc`); }));
    await runOnce(id, scripted(async (req) => ({
      raw: { schema_version: 1, alignment: "good", image_flags: [], slots: req.slots.map((s) => ({ slot_id: s.slot_id, quantity: 1, confidence: 0.9, flags: [] })) },
      usage: { input_tokens: 5, authorization: `Bearer ${SECRET}`, signed_url: "https://signed.example/x" },
    })));
    const evidence = JSON.stringify([await attempts(id), await jobRows(id), await scanRow(id),
      await q("select metadata from public.audit_events where resource_id = $1", [id]), logLines]);
    expect(evidence).not.toContain(SECRET);
    expect(evidence).not.toContain("signed.example");
    expect((await attempts(id)).map((a) => [a.outcome, a.error_code, a.usage_json])).toEqual([
      ["provider_error", "PROVIDER_NETWORK", null], ["succeeded", null, { input_tokens: 5 }]]);
  });

  it("explicit retry adds at most two generations, server-side, for authorized actors", async () => {
    const id = await queuedScan();
    await runOnce(id, fail(new VisionProviderError("permanent", "PROVIDER_REJECTED")));
    let s = await scanRow(id);
    expect((await retry(peer, id, s.revision)).error?.message).toBe("FORBIDDEN");
    expect((await retry(outsider, id, s.revision)).error?.message).toBe("NOT_FOUND");
    expect((await retry(owner(id), id, s.revision - 1)).error?.message).toBe("CONFLICT");
    const key = randomUUID();
    const first = await retry(owner(id), id, s.revision, key);
    expect(first.error).toBeNull();
    expect((first.data as any).payload).toMatchObject({ status: "queued", job_generation: 1, retry_generation_count: 1, failure_code: null });
    expect((await retry(owner(id), id, s.revision, key)).data).toMatchObject({ replayed: true });
    expect((await retry(owner(id), id, s.revision + 5, key)).error?.message).toBe("CONFLICT");
    expect((await jobRows(id)).map((j) => [j.generation, j.state])).toEqual([[0, "failed"], [1, "queued"]]);
    // New generation, fresh three-attempt budget.
    expect((await claimFor(id, mock("good"))).generation).toBe(1);
    await q("update public.scan_jobs set lease_until = now() - interval '1 second' where scan_id = $1 and generation = 1", [id]);
    await q("update public.scan_jobs set attempt_count = 3 where scan_id = $1 and generation = 1", [id]);
    expect(await queue.claim(attemptPolicy(mock("good")))).toBeNull();
    s = await scanRow(id);
    expect(s).toMatchObject({ status: "failed", failure_code: "ANALYSIS_TIMEOUT" });
    expect((await retry(manager, id, s.revision)).error).toBeNull();
    await q("update public.scans set status = 'failed', failure_code = 'PROVIDER_REJECTED', revision = revision + 1 where id = $1", [id]);
    await q("update public.scan_jobs set state = 'failed' where scan_id = $1 and state = 'queued'", [id]);
    s = await scanRow(id);
    const exhausted = await retry(owner(id), id, s.revision);
    expect(exhausted.error).toMatchObject({ message: "CONFLICT", details: "RETRY_LIMIT" });
    expect((await scanRow(id)).retry_generation_count).toBe(2);
    const queued = await queuedScan();
    expect((await retry(owner(queued), queued, 2)).error?.message).toBe("CONFLICT"); // not failed
  });
});

describe("leases, restarts and duplicate delivery", () => {
  it("an expired lease is reclaimed; the dead holder's late result is fenced and accepted exactly once", async () => {
    const id = await queuedScan();
    const first = await claimFor(id, mock("good"));
    expect((await scanRow(id)).status).toBe("processing");
    // Worker dies after claim: lease runs out.
    await q("update public.scan_jobs set lease_until = now() - interval '1 second' where id = $1", [first.job_id]);
    const second = await queue.claim(attemptPolicy(mock("good")));
    expect(second).toMatchObject({ job_id: first.job_id, attempt_number: 2 });
    expect(second!.lease_token).not.toBe(first.lease_token);
    expect((await attempts(id))[0]).toMatchObject({ outcome: "timeout", error_code: "LEASE_EXPIRED" });
    // The first worker was only slow (crashed after provider return): its write is fenced.
    expect(await processJob({ queue, vision: mock("poor_alignment"), logger }, first)).toEqual({ status: "fenced" });
    expect((await scanRow(id)).status).toBe("processing");
    expect(await processJob({ queue, vision: mock("good"), logger }, second!)).toEqual({ status: "committed" });
    const committed = await scanRow(id);
    // A third, duplicated delivery of the old lease changes nothing.
    expect(await processJob({ queue, vision: mock("poor_alignment"), logger }, first)).toEqual({ status: "fenced" });
    expect(await scanRow(id)).toMatchObject({ revision: committed.revision, status: "needs_review" });
    expect((await scanRow(id)).ai_summary.alignment).toBe("good");
    expect((await slots(id)).map((r) => r.ai_quantity)).toEqual([1, 2, 3]);
    expect((await attempts(id)).map((a) => a.outcome)).toEqual(["timeout", "succeeded"]);
    expect((await attempts(id))[0]!.usage_json).toEqual({ input_tokens: 0, output_tokens: 0, image_count: 2 }); // billing evidence kept
    expect(await q("select 1 from public.audit_events where resource_id = $1 and event_type = 'scan.analysis_completed'", [id])).toHaveLength(1);
  });

  it("a lease that expires on the last attempt fails the scan instead of looping", async () => {
    const id = await queuedScan();
    const job = await claimFor(id, mock("good"));
    await q("update public.scan_jobs set attempt_count = 3, lease_until = now() - interval '1 second' where id = $1", [job.job_id]);
    expect(await queue.claim(attemptPolicy(mock("good")))).toBeNull();
    expect(await scanRow(id)).toMatchObject({ status: "failed", failure_code: "ANALYSIS_TIMEOUT" });
    expect(await queue.heartbeat(job)).toBe(false);
  });

  it("concurrent claims hand a job to exactly one worker", async () => {
    const id = await queuedScan();
    await q("update public.scan_jobs set available_at = now() where scan_id = $1", [id]);
    const claims = await Promise.all(Array.from({ length: 6 }, () => queue.claim(attemptPolicy(mock("good")))));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await attempts(id))).toHaveLength(1);
  });

  it("at most two live leases per store; a full store is skipped while other stores continue", async () => {
    const a = [await queuedScan(), await queuedScan(), await queuedScan()];
    const b = await queuedScan(displayB);
    await q("update public.scan_jobs set available_at = now() - interval '1 minute' where scan_id = any($1)", [a]);
    await q("update public.scan_jobs set available_at = now() where scan_id = $1", [b]);
    const policy = attemptPolicy(mock("good"));
    const claimed = [await queue.claim(policy), await queue.claim(policy), await queue.claim(policy), await queue.claim(policy)];
    expect(claimed.slice(0, 2).map((j) => j?.store_id)).toEqual([storeA, storeA]);
    expect(claimed[2]?.scan_id).toBe(b);
    expect(claimed[3]).toBeNull();
    // Freeing a lease admits the third storeA scan.
    await processJob({ queue, vision: mock("good"), logger }, claimed[0]!);
    const remaining = a.find((id) => !claimed.some((j) => j?.scan_id === id));
    expect((await queue.claim(policy))?.scan_id).toBe(remaining);
  });

  it("heartbeats extend only a current lease", async () => {
    const id = await queuedScan();
    const job = await claimFor(id, mock("good"));
    await q("update public.scan_jobs set lease_until = now() + interval '5 seconds' where id = $1", [job.job_id]);
    expect(await queue.heartbeat(job)).toBe(true);
    const until = Date.parse((await jobRows(id))[0]!.lease_until);
    expect(until - Date.now()).toBeGreaterThan(80_000);
    expect(await queue.heartbeat({ ...job, lease_token: randomUUID() })).toBe(false);
  });
});

describe("manual takeover", () => {
  it("takeover during a provider call fences the late result and starts counts unknown", async () => {
    const id = await queuedScan();
    const job = await claimFor(id, mock("good"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = scripted(async (req) => {
      await gate;
      return { raw: { schema_version: 1, alignment: "good", image_flags: [], slots: req.slots.map((s) => ({ slot_id: s.slot_id, quantity: 4, confidence: 0.99, flags: [] })) }, usage: { input_tokens: 9 } };
    });
    const running = processJob({ queue, vision: slow, logger, timing: { heartbeatMs: 60_000 } }, job);
    const before = await scanRow(id);
    expect(before.status).toBe("processing");
    expect((await takeover(peer, id, before.revision)).error?.message).toBe("FORBIDDEN");
    const taken = await takeover(owner(id), id, before.revision);
    expect(taken.error).toBeNull();
    release();
    expect(await running).toEqual({ status: "fenced" });
    const s = await scanRow(id);
    expect(s).toMatchObject({ status: "needs_review", source: "manual", job_generation: 1, revision: before.revision + 1, ai_summary: null, failure_code: null });
    expect(s.image_path).not.toBeNull(); // image retained for audit
    expect((await slots(id)).every((r) => r.ai_quantity === null && r.accepted_quantity === null && r.review_required && r.review_state === "pending")).toBe(true);
    expect((await jobRows(id))[0]).toMatchObject({ state: "cancelled", lease_token: null });
    expect((await attempts(id))[0]).toMatchObject({ outcome: "cancelled", error_code: "MANUAL_TAKEOVER", usage_json: { input_tokens: 9 } });
    expect(await queue.heartbeat(job)).toBe(false);
    expect(await queue.claim(attemptPolicy(mock("good")))).toBeNull();
    expect(await q("select actor_id from public.audit_events where resource_id = $1 and event_type = 'scan.manual_takeover'", [id])).toEqual([{ actor_id: owner(id).id }]);
    // Counts and confirmation continue through the unchanged Feature 06 engine.
    const counts = await w.service.rpc("mutate_scan_counts", { p_actor: owner(id).id, p_scan_id: id, p_expected_revision: s.revision, p_action: "counts",
      p_items: job.slots.map((sl) => ({ slot_id: sl.slot_id, quantity: 1, verified: true, reason: "manual_count" })), p_key: randomUUID(), p_request_id: randomUUID() });
    expect(counts.error).toBeNull();
    expect((await takeover(owner(id), id, s.revision + 1)).error?.message).toBe("CONFLICT"); // review already started
  });

  it("a lost heartbeat aborts the in-flight provider call after takeover", async () => {
    const id = await queuedScan();
    const job = await claimFor(id, mock("good"));
    let aborted = false;
    const hanging = scripted((_req, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); })));
    const running = processJob({ queue, vision: hanging, logger, timing: { heartbeatMs: 25, providerTimeoutMs: 10_000 } }, job);
    await takeover(manager, id, (await scanRow(id)).revision);
    expect(await running).toEqual({ status: "fenced" });
    expect(aborted).toBe(true);
  });

  it("takeover from awaiting upload expires the upload intent and blocks later uploads", async () => {
    const id = await createPhotoScan();
    const employee = owner(id);
    expect((await takeover(owner(id), id, 1)).error).toBeNull();
    expect((await q("select state from public.upload_intents where resource_id = $1", [id]))[0]!.state).toBe("expired");
    expect((await w.service.rpc("photo_scan_workflow", { p_actor: employee.id, p_action: "authorize", p_resource: id, p_input: {} })).error?.message).toBe("CONFLICT");
    expect(await scanRow(id)).toMatchObject({ status: "needs_review", source: "manual", image_path: null });
  });

  it("takeover of a failed scan is allowed; analysis can no longer write afterwards", async () => {
    const id = await queuedScan();
    await runOnce(id, scripted(async () => { throw new VisionProviderError("permanent", "PROVIDER_REJECTED"); }));
    const s = await scanRow(id);
    expect((await takeover(manager, id, s.revision)).error).toBeNull();
    expect((await retry(owner(id), id, s.revision + 1)).error?.message).toBe("CONFLICT");
  });
});
