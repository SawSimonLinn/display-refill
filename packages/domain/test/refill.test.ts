import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateRefill, ConfirmScanRequest, SaveCountsRequest } from "../src/refill";
const fixture = JSON.parse(readFileSync(new URL("../../../context/examples/refill-cases.json", import.meta.url), "utf8")) as {
  cases: {
    name: string;
    target: number;
    threshold: number | null;
    current: number | null;
    expected_refill: number | null;
  }[];
  invalid_inputs: Record<string, number>[];
  aggregation: { slots: { product: string; target: number; threshold: number | null; current: number }[]; expected_product_refill: Record<string, number>; expected_fill_score: number };
};
const product = randomUUID();
const slot = (target = 3, threshold: number | null = null, current: number | null = 0) => ({ slot_id: randomUUID(), product_id: product, target, threshold, current });
describe("authoritative refill", () => {
  for (const c of fixture.cases)
    it(c.name, () => expect(calculateRefill([slot(c.target, c.threshold, c.current)]).total_refill).toBe(c.expected_refill));
  for (const invalid of fixture.invalid_inputs)
    it(`rejects ${JSON.stringify(invalid)}`, () => expect(() => calculateRefill([{ ...slot(), ...invalid }])).toThrow());
  it("aggregates repeated products and scores per slot", () => {
    const result = calculateRefill(fixture.aggregation.slots.map((s) => slot(s.target, s.threshold, s.current)));
    expect(result.products).toEqual([{ product_id: product, refill_quantity: fixture.aggregation.expected_product_refill.cobb }]);
    expect(result.display_score).toBe(fixture.aggregation.expected_fill_score);
    const excess = calculateRefill([slot(3, null, 999), slot(2, null, 0)]);
    expect(excess.total_refill).toBe(2);
    expect(excess.display_score).toBe(60);
  });
  it("keeps refill bounded across all allowed current counts", () => {
    for (const target of [1, 3, 8, 999]) {
      for (const threshold of [null, 0, target]) {
        for (let current = 0; current <= 999; current++) {
          const result = calculateRefill([slot(target, threshold, current)]);
          expect(result.total_refill).toBeGreaterThanOrEqual(0);
          expect(result.total_refill).toBeLessThanOrEqual(target);
          if (current >= target) expect(result.total_refill).toBe(0);
        }
      }
    }
  });
  it("unknown poisons only its product plus display total and score", () => {
    const known = { ...slot(), product_id: randomUUID() };
    const result = calculateRefill([slot(3, null, null), slot(), known]);
    expect(result.products).toEqual([{ product_id: product, refill_quantity: null }, { product_id: known.product_id, refill_quantity: 3 }]);
    expect(result.total_refill).toBeNull();
    expect(result.display_score).toBeNull();
  });
  it("rounds halves up and ignores triggers for score", () => {
    expect(calculateRefill([slot(8, 0, 1)]).display_score).toBe(13);
    expect(calculateRefill([slot(3, 1, 2)]).display_score).toBe(67);
  });
  it("rejects invalid bounds, duplicates, null/string human counts and injected authority", () => {
    for (const value of [-1, 1.5, 1000, NaN, Infinity])
      expect(() => calculateRefill([slot(3, null, value)])).toThrow();
    for (const target of [0, 1000, 1.5])
      expect(() => calculateRefill([slot(target)])).toThrow();
    expect(() => calculateRefill([])).toThrow();
    const s = slot();
    expect(() => calculateRefill([s, s])).toThrow();
    const item = { slot_id: s.slot_id, quantity: 0, verified: true };
    for (const quantity of [null, "0", -1, 1.5, 1000])
      expect(SaveCountsRequest.safeParse({ expected_revision: 1, items: [{ ...item, quantity }] }).success).toBe(false);
    expect(SaveCountsRequest.safeParse({ expected_revision: 1, items: [item, item] }).success).toBe(false);
    expect(SaveCountsRequest.safeParse({ expected_revision: 1, items: [{ ...item, target: 999 }] }).success).toBe(false);
    expect(ConfirmScanRequest.safeParse({ expected_revision: 1, total_refill: 0 }).success).toBe(false);
  });
});
