import { ConfigurationError, createLogger, createVisionAdapter, loadWorkerConfig } from "@display-refill/server";
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
  const deps = { logger, vision: createVisionAdapter(config.visionProvider) };

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
    console.error(JSON.stringify({ level: "error", service: "scan-worker", message: "fatal", error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  },
);
