import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_STATUS,
  ApiErrorCode,
  ErrorEnvelope,
  findNonSnakeCaseKeys,
  HealthEnvelope,
  normalizeVisionOutput,
  QuantityOrUnknown,
  REVIEW_POLICY,
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

describe("normalizeVisionOutput", () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const slot = (slot_id: string, quantity: number | null, confidence: number | null, flags: string[] = []) => ({ slot_id, quantity, confidence, flags });
  const output = (slots: unknown[], extra: Record<string, unknown> = {}) =>
    VisionResponseV1.parse({ schema_version: 1, alignment: "good", image_flags: [], slots, ...extra });

  it("confidence, null values and flags route review; zero stays zero", () => {
    const r = normalizeVisionOutput(output([slot(ids[0]!, 0, 0.95), slot(ids[1]!, 2, 0.79), slot(ids[2]!, 4, null)]), ids);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.slots.map((s) => [s.quantity, s.review_required])).toEqual([[0, false], [2, true], [4, true]]);
    const exact = normalizeVisionOutput(output([slot(ids[0]!, 1, 0.8, ["wrong_product"])]), [ids[0]!]);
    expect(exact.ok && exact.value.slots[0]).toMatchObject({ quantity: 1, review_required: true });
    const atThreshold = normalizeVisionOutput(output([slot(ids[0]!, 1, 0.8)]), [ids[0]!]);
    expect(atThreshold.ok && atThreshold.value.slots[0]!.review_required).toBe(false);
  });

  it("missing pinned slots become unknown and ambiguous, in pinned order", () => {
    const r = normalizeVisionOutput(output([slot(ids[2]!, 1, 0.9)]), ids);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.slots.map((s) => s.slot_id)).toEqual(ids);
    expect(r.value.slots[0]).toEqual({ slot_id: ids[0], quantity: null, confidence: null, flags: ["ambiguous"], review_required: true });
  });

  it("extra or duplicate slot IDs reject the whole response", () => {
    expect(normalizeVisionOutput(output([slot(ids[0]!, 1, 0.9), slot(ids[0]!, 2, 0.9)]), ids)).toEqual({ ok: false, code: "DUPLICATE_SLOT_ID" });
    expect(normalizeVisionOutput(output([slot("44444444-4444-4444-8444-444444444444", 1, 0.9)]), ids)).toEqual({ ok: false, code: "UNKNOWN_SLOT_ID" });
  });

  it("uncertain/poor alignment forces unknown; image flags require review of all slots", () => {
    for (const alignment of ["uncertain", "poor"]) {
      const r = normalizeVisionOutput(output([slot(ids[0]!, 3, 0.99)], { alignment }), [ids[0]!]);
      expect(r.ok && r.value.slots[0]).toMatchObject({ quantity: null, confidence: 0.99, review_required: true });
    }
    const glare = normalizeVisionOutput(output([slot(ids[0]!, 3, 0.99)], { image_flags: ["glare"] }), [ids[0]!]);
    expect(glare.ok && glare.value.slots[0]).toMatchObject({ quantity: 3, review_required: true });
    expect(REVIEW_POLICY).toEqual({ version: "review-v1", confidenceThreshold: 0.8 });
  });
});
