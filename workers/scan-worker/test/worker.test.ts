import { createLogger, MockVisionAdapter } from "@display-refill/server";
import { describe, expect, it } from "vitest";
import { runSelfCheck, runWorker } from "../src/worker";

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, logger: createLogger("scan-worker", "debug", (_l, line) => lines.push(JSON.parse(line))) };
}

describe("scan worker", () => {
  it("self-check validates mock vision output", async () => {
    const { lines, logger } = capture();
    await runSelfCheck({ logger, vision: new MockVisionAdapter() });
    expect(lines.at(-1)).toMatchObject({ message: "self-check passed", provider: "mock", slots: 2, unknown_slots: 1 });
  });

  it("self-check fails when an adapter returns invalid output", async () => {
    const { logger } = capture();
    const broken = { provider: "broken", analyze: async () => ({ schema_version: 1 }) };
    await expect(runSelfCheck({ logger, vision: broken })).rejects.toThrow(/schema validation/);
  });

  it("runs until aborted and shuts down cleanly", async () => {
    const { lines, logger } = capture();
    const controller = new AbortController();
    const running = runWorker({ logger, vision: new MockVisionAdapter(), idleIntervalMs: 5 }, controller.signal);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await running;
    expect(lines[0]).toMatchObject({ message: "worker started", job_queue: "not_implemented" });
    expect(lines.at(-1)).toMatchObject({ message: "worker stopped" });
  });
});
