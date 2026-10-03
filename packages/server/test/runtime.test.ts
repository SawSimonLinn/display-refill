import { ErrorEnvelope, HealthEnvelope, VisionResponseV1 } from "@display-refill/domain";
import { describe, expect, it } from "vitest";
import { createLogger, jsonData, jsonError, MockVisionAdapter, redact, resolveRequestId, validateVisionOutput, VisionOutputInvalidError } from "../src";

describe("redact / logger", () => {
  it("hides credential-like fields at any depth", () => {
    expect(redact({ user: "a", service_role_key: "x", nested: { authorization: "Bearer y", list: [{ password: "z" }] } })).toEqual({
      user: "a",
      service_role_key: "[redacted]",
      nested: { authorization: "[redacted]", list: [{ password: "[redacted]" }] },
    });
  });

  it("filters by level and emits JSON lines", () => {
    const lines: string[] = [];
    const log = createLogger("test", "warn", (_level, line) => lines.push(line));
    log.info("hidden");
    log.warn("shown", { api_key: "secret-value" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "warn", service: "test", message: "shown", api_key: "[redacted]" });
  });
});

describe("http envelopes", () => {
  it("reuses a valid request id and replaces an invalid one", () => {
    const id = "0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10";
    expect(resolveRequestId(new Headers({ "x-request-id": id.toUpperCase() }))).toBe(id);
    expect(resolveRequestId(new Headers({ "x-request-id": "<script>" }))).not.toBe("<script>");
  });

  it("serializes data and error envelopes with no-store", async () => {
    const id = crypto.randomUUID();
    const ok = jsonData({ status: "ok" }, id);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toEqual({ data: { status: "ok" }, request_id: id });

    const err = jsonError("CONFIGURATION_INVALID", "Missing configuration.", id);
    expect(err.status).toBe(503);
    expect(ErrorEnvelope.parse(await err.json()).error.field_errors).toEqual({});
    expect(HealthEnvelope.safeParse({ data: {}, request_id: id }).success).toBe(false);
  });
});

describe("MockVisionAdapter", () => {
  const slotIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

  it("returns schema-valid output for exactly the requested slots", async () => {
    const output = validateVisionOutput(await new MockVisionAdapter().analyze({ scan_id: crypto.randomUUID(), slot_ids: slotIds }));
    expect(output.slots.map((s) => s.slot_id)).toEqual(slotIds);
    expect(output.slots[1]).toMatchObject({ quantity: null, confidence: null, flags: ["occluded"] });
    expect(VisionResponseV1.parse(output)).toEqual(output);
  });

  it("honours cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new MockVisionAdapter().analyze({ scan_id: "x", slot_ids: [] }, controller.signal)).rejects.toThrow();
  });

  it("validator rejects malformed provider output", () => {
    expect(() => validateVisionOutput({ schema_version: 1, alignment: "good", image_flags: [], slots: [{ slot_id: "nope" }] })).toThrow(
      VisionOutputInvalidError,
    );
  });
});
