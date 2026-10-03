import { type Logger, type VisionAdapter, validateVisionOutput } from "@display-refill/server";

export interface WorkerDeps {
  logger: Logger;
  vision: VisionAdapter;
  /** Idle poll interval. The real claim loop (feature 09) starts at 1 s with backoff. */
  idleIntervalMs?: number;
}

/**
 * Exercises the vision adapter boundary end to end (raw output → strict
 * validator) with synthetic slot IDs. Used by `--once` as a smoke check.
 */
export async function runSelfCheck({ logger, vision }: WorkerDeps): Promise<void> {
  const slotIds = [crypto.randomUUID(), crypto.randomUUID()];
  const output = validateVisionOutput(await vision.analyze({ scan_id: crypto.randomUUID(), slot_ids: slotIds }));
  const unknown = output.slots.filter((slot) => slot.quantity === null).length;
  logger.info("self-check passed", { provider: vision.provider, slots: output.slots.length, unknown_slots: unknown });
}

/**
 * Persistent process lifecycle. There is no job table until features 02/09, so
 * each tick only records that the queue is not implemented; it never claims or
 * fabricates work. Resolves after `signal` aborts.
 */
export async function runWorker(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  const interval = deps.idleIntervalMs ?? 30_000;
  deps.logger.info("worker started", { provider: deps.vision.provider, job_queue: "not_implemented" });
  while (!signal.aborted) {
    deps.logger.debug("idle: job queue not implemented");
    await sleep(interval, signal);
  }
  deps.logger.info("worker stopped");
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
