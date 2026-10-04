import { ConfigurationError, createLogger, createVisionAdapter, createWorkerServiceClient, loadWorkerConfig } from "@display-refill/server";
import { SupabaseQueueStore } from "./queue";
import { runSelfCheck, runWorker } from "./worker";

async function main(): Promise<number> {
  let config;
  try {
    config = loadWorkerConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      return 78; // EX_CONFIG
    }
    throw error;
  }

  const logger = createLogger("scan-worker", config.logLevel);
  const vision = createVisionAdapter(config.visionProvider, config.visionMockScenario);
  const client = createWorkerServiceClient(config);
  if (process.argv.includes("--metrics")) {
    const r = await client.rpc("operations_metrics");
    if (r.error) throw new Error("METRICS_FAILED");
    logger.info("operations metrics", { metrics: r.data });
    return 0;
  }
  if (process.argv.includes("--cleanup")) {
    const host = new URL(config.supabaseUrl).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host) &&
        (!process.argv.includes("--approved-retention") || !process.argv.includes(`--confirm-project=${host}`))) {
      throw new Error("RETENTION_APPROVAL_REQUIRED");
    }
    const { runCleanup } = await import("./retention");
    await runCleanup(client, logger, config.scanImageRetentionDays, config.cleanupBatchSize);
    return 0;
  }
  const deps = { logger, vision, concurrency: config.concurrency, queue: new SupabaseQueueStore(client) };

  if (process.argv.includes("--once")) {
    await runSelfCheck(deps);
    return 0;
  }

  const controller = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      logger.info("shutdown requested", { signal: sig });
      controller.abort();
    });
  }
  await runWorker(deps, controller.signal);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const known = ["METRICS_FAILED", "CLEANUP_PREPARE_FAILED", "CLEANUP_CLAIM_FAILED", "CLEANUP_FINISH_FAILED", "RETENTION_APPROVAL_REQUIRED"];
    const code = error instanceof Error && known.includes(error.message) ? error.message : "WORKER_FATAL";
    console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", service: "scan-worker", message: "fatal", error_code: code }));
    process.exit(1);
  },
);
