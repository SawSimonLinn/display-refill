import { createHash } from "node:crypto";
import { normalizeVisionOutput, REVIEW_POLICY, VISION_PROMPT_VERSION, VISION_SCHEMA_VERSION } from "@display-refill/domain";
import {
  type Logger, sanitizeVisionUsage, type VisionAdapter, type VisionImage, VisionOutputInvalidError,
  VisionProviderError, validateVisionOutput,
} from "@display-refill/server";
import sharp from "sharp";
import { type AttemptPolicy, type ClaimedJob, type FinishEvidence, type FinishOutcome, type FinishResult, QueueError, type QueueStore } from "./queue";

/** Timing from scan-lifecycle.md: 45 s provider deadline, heartbeat every 20 s on a 90 s lease. */
export interface PipelineTiming {
  providerTimeoutMs: number;
  heartbeatMs: number;
}
export const DEFAULT_TIMING: PipelineTiming = { providerTimeoutMs: 45_000, heartbeatMs: 20_000 };

export interface PipelineDeps {
  queue: QueueStore;
  vision: VisionAdapter;
  logger: Logger;
  timing?: Partial<PipelineTiming>;
}

export function attemptPolicy(vision: VisionAdapter): AttemptPolicy {
  return {
    provider: vision.provider, model: vision.model, promptVersion: VISION_PROMPT_VERSION,
    schemaVersion: VISION_SCHEMA_VERSION, policyVersion: REVIEW_POLICY.version,
    confidenceThreshold: REVIEW_POLICY.confidenceThreshold,
  };
}

class FencedError extends Error {}
class ProviderTimeoutError extends Error {}
class InputError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); }
}

/**
 * Canonical images were validated at finalization; this re-checks the actual
 * decoded bytes so the provider only ever receives a JPEG within limits.
 */
async function loadImage(bytes: Uint8Array): Promise<VisionImage> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "error" }).metadata();
    const width = meta.width ?? 0, height = meta.height ?? 0;
    if (meta.format !== "jpeg" || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) {
      throw new InputError("IMAGE_INVALID", false);
    }
    return { bytes, width, height, media_type: "image/jpeg" };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("IMAGE_INVALID", false);
  }
}

/** Bounds an adapter that ignores its abort signal. */
function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Processes one claimed job end to end. Every outcome goes through
 * `finish_scan_attempt`, which records the attempt and applies job/scan
 * changes only while this lease and generation are current. Returns the
 * database's verdict, or `abandoned` when the outcome could not be recorded
 * (the lease then expires and the job is reclaimed).
 */
export async function processJob(deps: PipelineDeps, job: ClaimedJob): Promise<FinishResult | { status: "abandoned" }> {
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const log = { job_id: job.job_id, scan_id: job.scan_id, generation: job.generation, attempt: job.attempt_number };
  const fence = new AbortController();
  const heartbeat = setInterval(() => {
    deps.queue.heartbeat(job).then(
      (live) => { if (!live) fence.abort(new FencedError()); },
      (error: unknown) => deps.logger.warn("heartbeat failed; lease continues until expiry", { ...log, error: errorCode(error) }),
    );
  }, timing.heartbeatMs);
  const evidence: FinishEvidence = {};
  let outcome: FinishOutcome;
  try {
    const scanBytes = await download(deps.queue, "display-scans", job.image_path);
    const image = await loadImage(scanBytes);
    evidence.input = { width: image.width, height: image.height, sha256: createHash("sha256").update(scanBytes).digest("hex") };
    const reference = job.reference_path ? await loadImage(await download(deps.queue, "pog-images", job.reference_path)) : null;
    fence.signal.throwIfAborted();

    const deadline = AbortSignal.timeout(timing.providerTimeoutMs);
    const signal = AbortSignal.any([deadline, fence.signal]);
    const started = performance.now();
    let result;
    try {
      result = await withDeadline(deps.vision.analyze({
        scan_id: job.scan_id, prompt_version: VISION_PROMPT_VERSION, schema_version: VISION_SCHEMA_VERSION,
        image, reference, slots: job.slots,
      }, signal), signal);
    } catch (error) {
      if (fence.signal.aborted) throw new FencedError();
      if (deadline.aborted) throw new ProviderTimeoutError();
      throw error;
    } finally {
      evidence.latencyMs = Math.round(performance.now() - started);
    }
    evidence.usage = sanitizeVisionUsage(result.usage);
    const normalized = normalizeVisionOutput(validateVisionOutput(result.raw), job.slots.map((s) => s.slot_id), REVIEW_POLICY.confidenceThreshold);
    outcome = normalized.ok
      ? { outcome: "succeeded", result: normalized.value }
      : { outcome: "invalid_output", errorCode: "INVALID_SLOT_IDS", retryable: true };
  } catch (error) {
    outcome = classify(error);
  }
  try {
    let verdict: FinishResult;
    try {
      verdict = await deps.queue.finish(job, outcome, evidence);
    } catch (error) {
      // The database refused the normalized result (defense in depth): record it as invalid output.
      if (outcome.outcome !== "succeeded" || !(error instanceof QueueError) || error.code !== "VALIDATION_FAILED") throw error;
      outcome = { outcome: "invalid_output", errorCode: "INVALID_OUTPUT", retryable: true };
      verdict = await deps.queue.finish(job, outcome, evidence);
    }
    deps.logger.info("attempt finished", {
      ...log, outcome: outcome.outcome, error_code: outcome.outcome === "succeeded" ? null : outcome.errorCode,
      result: verdict.status, latency_ms: evidence.latencyMs ?? null,
    });
    return verdict;
  } catch (error) {
    deps.logger.error("attempt outcome not recorded; lease will expire", { ...log, error: errorCode(error) });
    return { status: "abandoned" };
  } finally {
    clearInterval(heartbeat);
  }
}

async function download(queue: QueueStore, bucket: "display-scans" | "pog-images", path: string) {
  try {
    return await queue.download(bucket, path);
  } catch {
    // Storage may be briefly unavailable; the attempt budget bounds retries.
    throw new InputError("IMAGE_UNAVAILABLE", true);
  }
}

function classify(error: unknown): FinishOutcome {
  if (error instanceof FencedError) return { outcome: "provider_error", errorCode: "FENCED", retryable: false };
  if (error instanceof ProviderTimeoutError) return { outcome: "timeout", errorCode: "PROVIDER_TIMEOUT", retryable: true };
  if (error instanceof InputError) return { outcome: "input_error", errorCode: error.code, retryable: error.retryable };
  if (error instanceof VisionOutputInvalidError) return { outcome: "invalid_output", errorCode: "INVALID_OUTPUT", retryable: true };
  if (error instanceof VisionProviderError) {
    return { outcome: "provider_error", errorCode: error.code, retryable: error.kind === "retryable", retryAfterSeconds: error.retryAfterSeconds };
  }
  // Unknown adapter failures are treated like transient network errors, bounded by the budget.
  return { outcome: "provider_error", errorCode: "PROVIDER_NETWORK", retryable: true };
}

/** Logs only stable codes, never provider messages that might echo secrets or URLs. */
function errorCode(error: unknown): string {
  if (error instanceof QueueError) return error.code;
  return error instanceof Error ? error.name : "UNKNOWN";
}
