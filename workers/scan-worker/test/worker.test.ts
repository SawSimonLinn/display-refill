import { createLogger, MockVisionAdapter, type VisionAdapter, VisionProviderError } from "@display-refill/server";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { processJob } from "../src/pipeline";
import type { ClaimedJob, FinishEvidence, FinishOutcome, FinishResult, QueueStore } from "../src/queue";
import { runSelfCheck, runWorker } from "../src/worker";

const SECRET = "sk-live-SENTINEL-do-not-log";

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, logger: createLogger("scan-worker", "debug", (_l, line) => lines.push(JSON.parse(line))) };
}

let jpeg: Uint8Array;
beforeAll(async () => {
  jpeg = new Uint8Array(await sharp({ create: { width: 80, height: 40, channels: 3, background: "#336699" } }).jpeg().toBuffer());
});

function job(slotCount = 2): ClaimedJob {
  return {
    job_id: crypto.randomUUID(), lease_token: crypto.randomUUID(), generation: 0, attempt_number: 1, attempt_id: crypto.randomUUID(),
    scan_id: crypto.randomUUID(), organization_id: crypto.randomUUID(), store_id: crypto.randomUUID(),
    image_path: "org/store/scan/validated-x.jpg", image_width: 80, image_height: 40,
    reference_path: "org/pog/ver/reference.jpg", reference_width: 80, reference_height: 40,
    slots: Array.from({ length: slotCount }, (_, i) => ({
      slot_id: crypto.randomUUID(), label: `A${i}`, x: i / slotCount, y: 0, width: 1 / slotCount, height: 1,
      product_name: "Synthetic", container_type: "tub", category: "fixture",
    })),
  };
}

class FakeQueue implements QueueStore {
  finished: Array<{ outcome: FinishOutcome; evidence: FinishEvidence }> = [];
  live = true;
  jobs: ClaimedJob[] = [];
  bytes: Uint8Array | null = null;
  rejectSucceeded = false;
  async claim() { return this.jobs.shift() ?? null; }
  async heartbeat() { return this.live; }
  async download() {
    if (!this.bytes) throw new Error("missing");
    return this.bytes;
  }
  async finish(_job: ClaimedJob, outcome: FinishOutcome, evidence: FinishEvidence): Promise<FinishResult> {
    if (this.rejectSucceeded && outcome.outcome === "succeeded") {
      const { QueueError } = await import("../src/queue");
      throw new QueueError("VALIDATION_FAILED");
    }
    this.finished.push({ outcome, evidence });
    return outcome.outcome === "succeeded" ? { status: "committed" } : { status: "failed", failure_code: outcome.errorCode };
  }
}

function adapter(analyze: VisionAdapter["analyze"]): VisionAdapter {
  return { provider: "scripted", model: "scripted-v1", analyze };
}

async function run(vision: VisionAdapter, opts: { slots?: number; live?: boolean; timing?: { providerTimeoutMs?: number; heartbeatMs?: number } } = {}) {
  const queue = new FakeQueue();
  queue.bytes = jpeg;
  queue.live = opts.live ?? true;
  const { lines, logger } = capture();
  const claimed = job(opts.slots);
  const verdict = await processJob({ queue, vision, logger, timing: opts.timing }, claimed);
  return { queue, lines, verdict, claimed, last: queue.finished.at(-1)! };
}

describe("self-check", () => {
  it("validates and normalizes mock vision output", async () => {
    const { lines, logger } = capture();
    await runSelfCheck({ logger, vision: new MockVisionAdapter() });
    expect(lines.at(-1)).toMatchObject({ message: "self-check passed", provider: "mock", slots: 2, unknown_slots: 1 });
  });

  it("fails when an adapter returns invalid output", async () => {
    const { logger } = capture();
    await expect(runSelfCheck({ logger, vision: adapter(async () => ({ raw: { schema_version: 1 } })) })).rejects.toThrow(/schema validation/);
  });
});

describe("processJob outcome classification", () => {
  it("good output is normalized in pinned order with sanitized usage and input evidence", async () => {
    const { last, verdict, claimed } = await run(adapter(async (req) => ({
      raw: { schema_version: 1, alignment: "good", image_flags: [], slots: [...req.slots].reverse().map((s) => ({ slot_id: s.slot_id, quantity: 3, confidence: 0.95, flags: [] })) },
      usage: { input_tokens: 12, api_key: SECRET },
    })));
    expect(verdict).toEqual({ status: "committed" });
    expect(last.outcome.outcome).toBe("succeeded");
    if (last.outcome.outcome !== "succeeded") throw new Error("unreachable");
    expect(last.outcome.result.slots.map((s) => s.slot_id)).toEqual(claimed.slots.map((s) => s.slot_id));
    expect(last.outcome.result.slots.every((s) => s.quantity === 3 && !s.review_required)).toBe(true);
    expect(last.evidence.usage).toEqual({ input_tokens: 12 });
    expect(last.evidence.input).toMatchObject({ width: 80, height: 40 });
    expect(last.evidence.input?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends validated bytes, reference and slots but no targets or thresholds", async () => {
    let seen: Record<string, unknown> | undefined;
    await run(adapter(async (req) => {
      seen = req as unknown as Record<string, unknown>;
      return { raw: { schema_version: 1, alignment: "good", image_flags: [], slots: req.slots.map((s) => ({ slot_id: s.slot_id, quantity: 1, confidence: 0.9, flags: [] })) } };
    }));
    expect(JSON.stringify(seen, (_k, v) => (v instanceof Uint8Array ? `bytes:${v.byteLength}` : v))).not.toMatch(/target|threshold|https?:/);
    expect((seen!.image as { media_type: string }).media_type).toBe("image/jpeg");
    expect(seen!.reference).not.toBeNull();
  });

  it("poor alignment and occlusion become unknown/required review", async () => {
    const poor = await run(new MockVisionAdapter("poor_alignment"));
    if (poor.last.outcome.outcome !== "succeeded") throw new Error("expected success");
    expect(poor.last.outcome.result.slots.every((s) => s.quantity === null && s.review_required)).toBe(true);
    const occluded = await run(new MockVisionAdapter("occluded"), { slots: 3 });
    if (occluded.last.outcome.outcome !== "succeeded") throw new Error("expected success");
    expect(occluded.last.outcome.result.slots[0]).toMatchObject({ quantity: null, flags: ["occluded"], review_required: true });
    expect(occluded.last.outcome.result.slots[1]).toMatchObject({ quantity: 1, review_required: true }); // image flag
  });

  it("missing slots become unknown; wrong or duplicate IDs and invalid schema are invalid output", async () => {
    const missing = await run(new MockVisionAdapter("missing_slot"), { slots: 3 });
    if (missing.last.outcome.outcome !== "succeeded") throw new Error("expected success");
    expect(missing.last.outcome.result.slots[0]).toMatchObject({ quantity: null, confidence: null, flags: ["ambiguous"], review_required: true });
    for (const scenario of ["duplicate_ids", "unknown_id"] as const) {
      expect((await run(new MockVisionAdapter(scenario))).last.outcome).toEqual({ outcome: "invalid_output", errorCode: "INVALID_SLOT_IDS", retryable: true });
    }
    expect((await run(new MockVisionAdapter("invalid"))).last.outcome).toEqual({ outcome: "invalid_output", errorCode: "INVALID_OUTPUT", retryable: true });
  });

  it("a database refusal of a normalized result is recorded as invalid output", async () => {
    const queue = new FakeQueue();
    queue.bytes = jpeg;
    queue.rejectSucceeded = true;
    const { logger } = capture();
    await processJob({ queue, vision: new MockVisionAdapter("good"), logger }, job());
    expect(queue.finished.at(-1)!.outcome).toEqual({ outcome: "invalid_output", errorCode: "INVALID_OUTPUT", retryable: true });
  });

  it("provider deadline is enforced even when an adapter ignores abort", async () => {
    const { last } = await run(adapter(() => new Promise(() => {})), { timing: { providerTimeoutMs: 30 } });
    expect(last.outcome).toEqual({ outcome: "timeout", errorCode: "PROVIDER_TIMEOUT", retryable: true });
    expect(last.evidence.latencyMs).toBeGreaterThanOrEqual(25);
  });

  it("maps retryable, Retry-After and permanent provider errors; messages are never logged", async () => {
    const limited = await run(adapter(async () => { throw new VisionProviderError("retryable", "PROVIDER_RATE_LIMITED", 42); }));
    expect(limited.last.outcome).toEqual({ outcome: "provider_error", errorCode: "PROVIDER_RATE_LIMITED", retryable: true, retryAfterSeconds: 42 });
    const config = await run(adapter(async () => { throw new VisionProviderError("permanent", "PROVIDER_CONFIGURATION"); }));
    expect(config.last.outcome).toMatchObject({ errorCode: "PROVIDER_CONFIGURATION", retryable: false });
    const network = await run(adapter(async () => { throw new Error(`socket reset for key ${SECRET} https://signed.example/x`); }));
    expect(network.last.outcome).toMatchObject({ errorCode: "PROVIDER_NETWORK", retryable: true });
    expect(JSON.stringify(network.lines)).not.toContain(SECRET);
    expect(JSON.stringify(network.lines)).not.toContain("signed.example");
  });

  it("a lost heartbeat aborts the provider call and is reported as fenced", async () => {
    const { last } = await run(adapter((_req, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))))), {
      live: false, timing: { heartbeatMs: 10, providerTimeoutMs: 5_000 },
    });
    expect(last.outcome).toEqual({ outcome: "provider_error", errorCode: "FENCED", retryable: false });
  });

  it("unavailable or non-JPEG input never reaches the provider", async () => {
    let called = false;
    const vision = adapter(async () => { called = true; return { raw: {} }; });
    const queue = new FakeQueue();
    const { logger } = capture();
    await processJob({ queue, vision, logger }, job());
    expect(queue.finished.at(-1)!.outcome).toEqual({ outcome: "input_error", errorCode: "IMAGE_UNAVAILABLE", retryable: true });
    queue.bytes = new TextEncoder().encode("not an image");
    await processJob({ queue, vision, logger }, job());
    expect(queue.finished.at(-1)!.outcome).toEqual({ outcome: "input_error", errorCode: "IMAGE_INVALID", retryable: false });
    expect(called).toBe(false);
  });
});

describe("runWorker", () => {
  it("claims queued work, processes it and shuts down cleanly", async () => {
    const queue = new FakeQueue();
    queue.bytes = jpeg;
    queue.jobs = [job(), job()];
    const { lines, logger } = capture();
    const controller = new AbortController();
    const running = runWorker({ logger, vision: new MockVisionAdapter("good"), queue, pollIntervalMs: 5, maxIdleIntervalMs: 10 }, controller.signal);
    for (let i = 0; i < 100 && queue.finished.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await running;
    expect(queue.finished.map((f) => f.outcome.outcome)).toEqual(["succeeded", "succeeded"]);
    expect(lines[0]).toMatchObject({ message: "worker started", job_queue: "postgres", provider: "mock" });
    expect(lines.at(-1)).toMatchObject({ message: "worker stopped" });
  });

  it("backs off when the database is unreachable instead of crashing", async () => {
    const queue = new FakeQueue();
    let claims = 0;
    queue.claim = async () => { claims++; throw new Error("fetch failed"); };
    const { lines, logger } = capture();
    const controller = new AbortController();
    const running = runWorker({ logger, vision: new MockVisionAdapter(), queue, pollIntervalMs: 5, maxIdleIntervalMs: 20 }, controller.signal);
    await new Promise((r) => setTimeout(r, 60));
    controller.abort();
    await running;
    expect(claims).toBeGreaterThan(1);
    expect(claims).toBeLessThan(12);
    expect(lines.some((l) => l.message === "claim failed; backing off")).toBe(true);
  });
});
