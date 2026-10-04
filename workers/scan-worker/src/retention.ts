import type { DbClient, Logger } from "@display-refill/server";

/** One bounded batch. Durable leases cover Storage success followed by process death. */
export async function runCleanup(client: DbClient, logger: Logger, days = 90, batch = 100): Promise<void> {
  const prepared = await client.rpc("prepare_image_cleanup", { p_days: days, p_batch: batch });
  if (prepared.error) throw new Error("CLEANUP_PREPARE_FAILED");
  const claimed = await client.rpc("claim_image_cleanup", { p_batch: batch });
  if (claimed.error) throw new Error("CLEANUP_CLAIM_FAILED");
  for (const job of claimed.data ?? []) {
    let success = false;
    try {
      // Storage remove is idempotent: an absent object is success. Never infer
      // absence from a failed download (which may be an outage/authorization error).
      const result = await client.storage.from(job.bucket).remove([job.object_path]);
      success = !result.error;
    } catch { /* Persist the stable error code and retry time below. */ }
    const finished = await client.rpc("finish_image_cleanup", { p_id: job.id, p_lease: job.lease_token!, p_success: success });
    logger.info("image cleanup outcome", { cleanup_id: job.id, scan_id: job.scan_id, attempt: job.attempts,
      status: finished.error ? "finish_failed" : finished.data ? success ? "succeeded" : "retry_scheduled" : "fenced" });
    if (finished.error) throw new Error("CLEANUP_FINISH_FAILED");
  }
}
