import type { NormalizedVision } from "@display-refill/domain";
import type { DbClient, Json } from "@display-refill/server";

/** Work handed out by `claim_scan_job`. Targets/thresholds are never included. */
export interface ClaimedJob {
  job_id: string;
  lease_token: string;
  generation: number;
  attempt_number: number;
  attempt_id: string;
  scan_id: string;
  organization_id: string;
  store_id: string;
  image_path: string;
  image_width: number | null;
  image_height: number | null;
  reference_path: string | null;
  reference_width: number | null;
  reference_height: number | null;
  slots: Array<{
    slot_id: string; label: string; x: number; y: number; width: number; height: number;
    product_name: string; container_type: string; category: string;
  }>;
}

export interface AttemptPolicy {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  policyVersion: string;
  confidenceThreshold: number;
}

export type FinishOutcome =
  | { outcome: "succeeded"; result: NormalizedVision }
  | { outcome: "invalid_output" | "provider_error" | "input_error" | "timeout"; errorCode: string; retryable: boolean; retryAfterSeconds?: number };

export interface FinishEvidence {
  latencyMs?: number;
  usage?: Record<string, number>;
  input?: { width: number; height: number; sha256: string };
}

export type FinishResult =
  | { status: "committed" | "fenced" }
  | { status: "requeued"; retry_in_seconds: number }
  | { status: "failed"; failure_code: string };

/** Database and private Storage access used by the worker; swapped for fakes in unit tests. */
export interface QueueStore {
  claim(policy: AttemptPolicy): Promise<ClaimedJob | null>;
  heartbeat(job: ClaimedJob): Promise<boolean>;
  finish(job: ClaimedJob, outcome: FinishOutcome, evidence: FinishEvidence): Promise<FinishResult>;
  download(bucket: "display-scans" | "pog-images", path: string): Promise<Uint8Array>;
}

/** Postgres error whose message is a stable API code (decision D26). */
export class QueueError extends Error {
  constructor(readonly code: string) {
    super(`Queue operation failed (${code}).`);
    this.name = "QueueError";
  }
}

export class SupabaseQueueStore implements QueueStore {
  constructor(private readonly client: DbClient) {}

  async claim(policy: AttemptPolicy): Promise<ClaimedJob | null> {
    const { data, error } = await this.client.rpc("claim_scan_job", {
      p_provider: policy.provider, p_model: policy.model, p_prompt_version: policy.promptVersion,
      p_schema_version: policy.schemaVersion, p_policy_version: policy.policyVersion,
      p_confidence_threshold: policy.confidenceThreshold,
    });
    if (error) throw new QueueError(error.message === "VISION_DISABLED" ? "VISION_DISABLED" : "CLAIM_FAILED");
    return (data as unknown as ClaimedJob | null) ?? null;
  }

  async heartbeat(job: ClaimedJob): Promise<boolean> {
    const { data, error } = await this.client.rpc("heartbeat_scan_job", { p_job: job.job_id, p_lease: job.lease_token });
    if (error) throw new QueueError("HEARTBEAT_FAILED");
    return data === true;
  }

  async finish(job: ClaimedJob, outcome: FinishOutcome, evidence: FinishEvidence): Promise<FinishResult> {
    const failure = outcome.outcome === "succeeded" ? null : outcome;
    const { data, error } = await this.client.rpc("finish_scan_attempt", {
      p_job: job.job_id,
      p_lease: job.lease_token,
      p_outcome: outcome.outcome,
      p_error_code: failure?.errorCode,
      p_retryable: failure?.retryable ?? false,
      p_retry_after_seconds: failure?.retryAfterSeconds,
      p_result: outcome.outcome === "succeeded" ? (outcome.result as unknown as Json) : undefined,
      p_latency_ms: evidence.latencyMs,
      p_usage: evidence.usage as Json | undefined,
      p_input: evidence.input as Json | undefined,
    });
    if (error) throw new QueueError("FINISH_FAILED");
    return data as unknown as FinishResult;
  }

  async download(bucket: "display-scans" | "pog-images", path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error || !data) throw new QueueError("IMAGE_UNAVAILABLE");
    return new Uint8Array(await data.arrayBuffer());
  }
}
