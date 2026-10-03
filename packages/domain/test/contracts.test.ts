import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_STATUS,
  ApiErrorCode,
  ErrorEnvelope,
  findNonSnakeCaseKeys,
  HealthEnvelope,
  QuantityOrUnknown,
  VisionResponseV1,
} from "../src";

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

const fixtures = {
  health: readJson("../fixtures/api/health.ok.json"),
  error: readJson("../fixtures/api/error.configuration-invalid.json"),
  vision: readJson("../fixtures/vision/response-v1.mixed.json"),
};

describe("fixtures", () => {
  it("match their schemas", () => {
    expect(HealthEnvelope.parse(fixtures.health).data.checks.authentication).toBe("not_checked");
    expect(ErrorEnvelope.parse(fixtures.error).error.code).toBe("CONFIGURATION_INVALID");
    expect(VisionResponseV1.parse(fixtures.vision).slots).toHaveLength(2);
  });

  it("use snake_case keys only", () => {
    for (const value of Object.values(fixtures)) {
      expect(findNonSnakeCaseKeys(value)).toEqual([]);
    }
  });

  it("vision fixture stays identical to the context example", () => {
    expect(fixtures.vision).toEqual(readJson("../../../context/examples/vision-response.json"));
  });
});

describe("snake_case convention", () => {
  it("reports camelCase keys with their path", () => {
    expect(findNonSnakeCaseKeys({ data: { slotId: 1, items: [{ ok_key: 1, BadKey: 2 }] } })).toEqual([
      "$.data.slotId",
      "$.data.items[0].BadKey",
    ]);
  });
});

describe("quantity", () => {
  it("keeps unknown distinct from zero", () => {
    expect(QuantityOrUnknown.parse(null)).toBeNull();
    expect(QuantityOrUnknown.parse(0)).toBe(0);
  });

  it.each([-1, 1.5, 1000, Number.NaN, "2"])("rejects %s", (value) => {
    expect(QuantityOrUnknown.safeParse(value).success).toBe(false);
  });
});

describe("VisionResponseV1", () => {
  const valid = VisionResponseV1.parse(fixtures.vision);

  it("rejects extra top-level and slot fields", () => {
    expect(VisionResponseV1.safeParse({ ...valid, refill: 3 }).success).toBe(false);
    const slot = { ...valid.slots[0], refill_quantity: 1 };
    expect(VisionResponseV1.safeParse({ ...valid, slots: [slot] }).success).toBe(false);
  });

  it("rejects out-of-contract values", () => {
    const base = valid.slots[0]!;
    for (const bad of [
      { ...base, quantity: 2.5 },
      { ...base, confidence: 1.2 },
      { ...base, flags: ["sticky"] },
      { ...base, slot_id: "slot-1" },
    ]) {
      expect(VisionResponseV1.safeParse({ ...valid, slots: [bad] }).success).toBe(false);
    }
    expect(VisionResponseV1.safeParse({ ...valid, schema_version: 2 }).success).toBe(false);
    expect(VisionResponseV1.safeParse({ ...valid, alignment: "great" }).success).toBe(false);
  });
});

describe("error codes", () => {
  it("each have an HTTP status", () => {
    for (const code of ApiErrorCode.options) {
      expect(API_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("iOS mock fixtures", () => {
  // MockAPIClient.swift embeds copies of the API fixtures; keep them identical.
  const swift = readFileSync(
    new URL("../../../apps/ios/DisplayRefillKit/Sources/DisplayRefillCore/MockAPIClient.swift", import.meta.url),
    "utf8",
  );
  const embedded = (name: string): unknown => {
    const match = new RegExp(`static let ${name} = Data\\("""\\n([\\s\\S]*?)\\n\\s*"""`).exec(swift);
    if (!match?.[1]) throw new Error(`fixture ${name} not found in MockAPIClient.swift`);
    return JSON.parse(match[1]);
  };

  it("match the shared JSON fixtures", () => {
    expect(embedded("healthOK")).toEqual(fixtures.health);
    expect(embedded("errorConfigurationInvalid")).toEqual(fixtures.error);
  });
});
