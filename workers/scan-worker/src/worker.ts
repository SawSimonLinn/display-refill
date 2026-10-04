import { normalizeVisionOutput } from "@display-refill/domain";
import { type Logger, type VisionAdapter, validateVisionOutput } from "@display-refill/server";
import { attemptPolicy, type PipelineTiming, processJob } from "./pipeline";
import type { QueueStore } from "./queue";

export interface WorkerDeps {
  logger: Logger;
  vision: VisionAdapter;
  queue?: QueueStore;
  /** In-process concurrent jobs. The store-level limit (two) is enforced by the database claim. */
  concurrency?: number;
  /** Poll interval starts here and backs off while idle (scan-lifecycle.md: 1 s with idle backoff). */
  pollIntervalMs?: number;
  maxIdleIntervalMs?: number;
  timing?: Partial<PipelineTiming>;
}

/**
 * Exercises the vision adapter boundary end to end (raw output → strict
 * validator → server normalization) with synthetic slots. Used by `--once`.
 */
export async function runSelfCheck({ logger, vision }: WorkerDeps): Promise<void> {
  const slots = [crypto.randomUUID(), crypto.randomUUID()].map((slot_id, i) => ({
    slot_id, label: `S${i + 1}`, x: i / 2, y: 0, width: 0.5, height: 1, product_name: "Synthetic", container_type: "tub", category: "fixture",
  }));
  const image = { bytes: new Uint8Array(), width: 1, height: 1, media_type: "image/jpeg" as const };
  const { raw } = await vision.analyze({ scan_id: crypto.randomUUID(), prompt_version: "self-check", schema_version: 1, image, reference: null, slots });
  const normalized = normalizeVisionOutput(validateVisionOutput(raw), slots.map((s) => s.slot_id));
  if (!normalized.ok) throw new Error(`Vision output failed slot validation (${normalized.code}).`);
  const unknown = normalized.value.slots.filter((slot) => slot.quantity === null).length;
  logger.info("self-check passed", { provider: vision.provider, slots: normalized.value.slots.length, unknown_slots: unknown });
}

/**
 * Persistent claim loop. Claims due jobs (including expired leases) while a
 * slot is free, processes them concurrently, and backs off while idle or when
 * the database is unreachable. On abort it stops claiming and waits for
 * in-flight attempts, which are bounded by the provider deadline.
 */
export async function runWorker(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  const { logger, vision } = deps;
  if (!deps.queue) throw new Error("runWorker requires a queue store");
  const queue = deps.queue;
  const concurrency = deps.concurrency ?? 2;
  const base = deps.pollIntervalMs ?? 1_000;
  const maxIdle = deps.maxIdleIntervalMs ?? 10_000;
  const policy = attemptPolicy(vision);
  const active = new Set<Promise<unknown>>();
  let idle = base;
  logger.info("worker started", { provider: vision.provider, model: vision.model, job_queue: "postgres", concurrency });
  while (!signal.aborted) {
    if (active.size >= concurrency) {
      await Promise.race([...active, aborted(signal)]);
      continue;
    }
    let job;
    try {
      job = await queue.claim(policy);
    } catch {
      logger.warn("claim failed; backing off", { error_code: "QUEUE_CLAIM_UNAVAILABLE" });
      await sleep(idle, signal);
      idle = Math.min(idle * 2, maxIdle);
      continue;
    }
    if (!job) {
      await sleep(idle, signal);
      idle = Math.min(idle * 2, maxIdle);
      continue;
    }
    idle = base;
    const work = processJob({ queue, vision, logger, timing: deps.timing }, job).finally(() => active.delete(work));
    active.add(work);
  }
  await Promise.allSettled([...active]);
  logger.info("worker stopped");
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
