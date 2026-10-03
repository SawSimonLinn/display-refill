import { describe, expect, it } from "vitest";
import {
  clampRect,
  containedRect,
  CreatePogVersionRequest,
  FinalizePogImageRequest,
  findFreeSpot,
  isInsideCrop,
  type LayoutSlot,
  layoutIssues,
  moveRect,
  NormalizedRect,
  nudgeRect,
  rectFromPoints,
  rectsOverlap,
  ReplaceSlotsRequest,
  resizeRect,
  toClientBox,
  toNormalizedPoint,
} from "../src";

const P = "30000000-0000-4000-8000-0000000000a1";
const slot = (over: Partial<Record<string, unknown>> = {}) => ({
  label: "A1", product_id: P, x: 0.05, y: 0.1, width: 0.4, height: 0.8, target_quantity: 3, refill_threshold: 1, sort_order: 0, ...over,
});

describe("normalized rectangles", () => {
  it("accepts rectangles touching the crop edges and rejects anything outside", () => {
    expect(isInsideCrop({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isInsideCrop({ x: 0.7, y: 0.3, width: 0.3, height: 0.7 })).toBe(true);
    for (const r of [
      { x: -0.01, y: 0, width: 0.5, height: 0.5 },
      { x: 1, y: 0, width: 0.1, height: 0.5 },
      { x: 0.5, y: 0, width: 0.500001, height: 0.5 },
      { x: 0, y: 0.6, width: 0.5, height: 0.5 },
      { x: 0, y: 0, width: 0, height: 0.5 },
      { x: 0, y: 0, width: 0.5, height: -0.1 },
    ]) {
      expect(isInsideCrop(r), JSON.stringify(r)).toBe(false);
    }
  });

  it("does not let floating-point sums make touching slots overlap", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point, so a naive
    // check would say a slot ending at 0.1 + 0.2 overlaps one starting at 0.3.
    expect(0.1 + 0.2).toBeGreaterThan(0.3);
    expect(rectsOverlap({ x: 0.1, y: 0, width: 0.2, height: 1 }, { x: 0.3, y: 0, width: 0.7, height: 1 })).toBe(false);
    expect(isInsideCrop({ x: 0.3, y: 0, width: 0.7, height: 1 })).toBe(true);
  });

  it("treats touching rectangles as non-overlapping and any shared area as overlap", () => {
    const left = { x: 0, y: 0, width: 0.3, height: 1 };
    expect(rectsOverlap(left, { x: 0.3, y: 0, width: 0.3, height: 1 })).toBe(false);
    expect(rectsOverlap(left, { x: 0.1 + 0.2, y: 0, width: 0.2, height: 1 })).toBe(false);
    expect(rectsOverlap(left, { x: 0.299999, y: 0.5, width: 0.1, height: 0.1 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, width: 1, height: 0.5 }, { x: 0, y: 0.5, width: 1, height: 0.5 })).toBe(false);
  });

  it("schema rejects more than six decimals, NaN and out-of-crop rectangles", () => {
    expect(NormalizedRect.safeParse({ x: 0.1234565, y: 0, width: 0.5, height: 0.5 }).success).toBe(false);
    expect(NormalizedRect.safeParse({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 }).success).toBe(false);
    expect(NormalizedRect.safeParse({ x: 0.6, y: 0, width: 0.5, height: 0.5 }).success).toBe(false);
    expect(NormalizedRect.safeParse({ x: 0.123456, y: 0, width: 0.5, height: 0.5 }).success).toBe(true);
  });
});

describe("letterbox-free coordinates at any viewport", () => {
  // A 1600×1200 reference (4:3) shown in boxes of several shapes and sizes,
  // including boxes that would letterbox it horizontally or vertically.
  const aspect = 1600 / 1200;
  const viewports = [
    { left: 0, top: 0, width: 800, height: 600 }, // exact fit
    { left: 120, top: 64, width: 1280, height: 600 }, // wide: bars left/right
    { left: 16, top: 200, width: 358, height: 700 }, // phone portrait: bars top/bottom
    { left: 0, top: 0, width: 2560, height: 1920 }, // zoomed / large display
    { left: 33.5, top: 10.25, width: 777.7, height: 333.3 },
  ];
  const slotRect = { x: 0.05, y: 0.1, width: 0.4, height: 0.8 };

  it("excludes the bars and keeps the image aspect ratio", () => {
    const wide = containedRect(viewports[1]!, aspect);
    expect(wide).toEqual({ left: 120 + (1280 - 800) / 2, top: 64, width: 800, height: 600 });
    const tall = containedRect(viewports[2]!, aspect);
    expect(tall.width).toBe(358);
    expect(tall.height).toBeCloseTo(268.5, 6);
    expect(tall.top).toBeCloseTo(200 + (700 - 268.5) / 2, 6);
  });

  it.each(viewports)("maps a slot's corners back to the same normalized coordinates (%o)", (box) => {
    const content = containedRect(box, aspect);
    const px = toClientBox(slotRect, content);
    const topLeft = toNormalizedPoint(px.left, px.top, content);
    const bottomRight = toNormalizedPoint(px.left + px.width, px.top + px.height, content);
    const drawn = rectFromPoints(topLeft, bottomRight);
    expect(drawn).toEqual(slotRect);
  });

  it("would drift if the element box (with bars) were used instead of the content box", () => {
    const box = viewports[1]!;
    const content = containedRect(box, aspect);
    const px = toClientBox(slotRect, content);
    const wrong = toNormalizedPoint(px.left, px.top, box);
    expect(Math.abs(wrong.x - slotRect.x)).toBeGreaterThan(0.1);
  });

  it("clamps pointer positions in the bars to the crop edge", () => {
    const content = containedRect(viewports[1]!, aspect);
    expect(toNormalizedPoint(content.left - 50, content.top + content.height + 50, content)).toEqual({ x: 0, y: 1 });
  });
});

describe("editor operations", () => {
  const r = { x: 0.1, y: 0.1, width: 0.2, height: 0.3 };

  it("moves without resizing and stops at the edges", () => {
    expect(moveRect(r, 0.05, -0.05)).toEqual({ x: 0.15, y: 0.05, width: 0.2, height: 0.3 });
    expect(moveRect(r, 5, 5)).toEqual({ x: 0.8, y: 0.7, width: 0.2, height: 0.3 });
    expect(moveRect(r, -5, -5)).toEqual({ x: 0, y: 0, width: 0.2, height: 0.3 });
  });

  it("resizes from any handle, keeping the opposite edge and a minimum size", () => {
    expect(resizeRect(r, "se", { x: 0.5, y: 0.6 })).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.5 });
    expect(resizeRect(r, "nw", { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 0.3, height: 0.4 });
    expect(resizeRect(r, "e", { x: 0.05, y: 0.9 })).toEqual({ x: 0.1, y: 0.1, width: 0.005, height: 0.3 });
    expect(resizeRect(r, "s", { x: 0, y: 2 })).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.9 });
  });

  it("keyboard: arrows move 1 % (Alt 0.1 %), Shift+arrows resize, other keys are ignored", () => {
    expect(nudgeRect(r, "ArrowRight", { shift: false, alt: false })).toEqual({ ...r, x: 0.11 });
    expect(nudgeRect(r, "ArrowUp", { shift: false, alt: true })).toEqual({ ...r, y: 0.099 });
    expect(nudgeRect(r, "ArrowRight", { shift: true, alt: false })).toEqual({ ...r, width: 0.21 });
    expect(nudgeRect(r, "ArrowUp", { shift: true, alt: false })).toEqual({ ...r, height: 0.29 });
    expect(nudgeRect({ x: 0.9, y: 0, width: 0.1, height: 0.1 }, "ArrowRight", { shift: true, alt: false })).toEqual({ x: 0.9, y: 0, width: 0.1, height: 0.1 });
    expect(nudgeRect(r, "Enter", { shift: false, alt: false })).toBeNull();
  });

  it("clamps typed values into the crop with editor precision", () => {
    expect(clampRect({ x: 0.123456, y: 0.9, width: 0.2, height: 0.3 })).toEqual({ x: 0.1235, y: 0.7, width: 0.2, height: 0.3 });
  });

  it("finds a free spot that overlaps no existing slot", () => {
    const existing = [{ x: 0, y: 0, width: 0.5, height: 0.2 }];
    const spot = findFreeSpot(existing, { width: 0.2, height: 0.2 })!;
    expect(rectsOverlap(spot, existing[0]!)).toBe(false);
    expect(spot).toEqual({ x: 0.5, y: 0, width: 0.2, height: 0.2 });
    expect(findFreeSpot([{ x: 0, y: 0, width: 1, height: 1 }], { width: 0.2, height: 0.2 })).toBeNull();
  });
});

describe("request schemas", () => {
  it("accepts a full slot set and rejects duplicate labels (case-insensitive) per slot", () => {
    expect(ReplaceSlotsRequest.safeParse({ expected_revision: 1, slots: [slot(), slot({ label: "A2", x: 0.55 })] }).success).toBe(true);
    const dup = ReplaceSlotsRequest.safeParse({ expected_revision: 1, slots: [slot(), slot({ label: "a1", x: 0.55 })] });
    expect(dup.success).toBe(false);
    expect(dup.error!.issues.map((i) => i.path.join("."))).toEqual(["slots.1.label"]);
  });

  it("rejects bad targets, triggers above target, fractions, out-of-crop rectangles and unknown fields", () => {
    const bad = (over: Record<string, unknown>) => ReplaceSlotsRequest.safeParse({ expected_revision: 1, slots: [slot(over)] }).success;
    expect(bad({ target_quantity: 0 })).toBe(false);
    expect(bad({ target_quantity: 1000 })).toBe(false);
    expect(bad({ target_quantity: 2.5 })).toBe(false);
    expect(bad({ refill_threshold: 4 })).toBe(false);
    expect(bad({ refill_threshold: -1 })).toBe(false);
    expect(bad({ x: 0.7 })).toBe(false);
    expect(bad({ organization_id: P })).toBe(false);
    expect(bad({ refill_threshold: null })).toBe(true);
    expect(bad({ refill_threshold: 3 })).toBe(true); // inclusive: equal to target is allowed
    expect(ReplaceSlotsRequest.safeParse({ expected_revision: 1, slots: Array.from({ length: 101 }, (_, i) => slot({ label: `S${i}` })) }).success).toBe(false);
  });

  it("finalize defaults to no rotation and the whole image; other rotations are refused", () => {
    const parsed = FinalizePogImageRequest.parse({ upload_id: P, expected_revision: 2 });
    expect(parsed).toMatchObject({ rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
    expect(FinalizePogImageRequest.safeParse({ upload_id: P, expected_revision: 2, rotation: 45 }).success).toBe(false);
    expect(CreatePogVersionRequest.safeParse({}).success).toBe(false);
    expect(CreatePogVersionRequest.safeParse({ source_version_id: null }).success).toBe(true);
  });
});

describe("layoutIssues", () => {
  const s = (key: string, over: Partial<LayoutSlot> = {}): LayoutSlot => ({
    key, label: key, product_id: P, product_active: true, x: 0, y: 0, width: 0.25, height: 1, target_quantity: 3, refill_threshold: null, ...over,
  });

  it("is empty for a publishable layout", () => {
    expect(layoutIssues([s("A1"), s("A2", { x: 0.25 })], { hasReference: true, needsReview: false })).toEqual([]);
  });

  it("reports every publication blocker with the slots involved", () => {
    const issues = layoutIssues(
      [s("A1"), s("A2", { x: 0.2, product_active: false }), s("a1", { x: 0.6, refill_threshold: 4 }), s("", { x: 0.9, width: 0.2, target_quantity: 0 })],
      { hasReference: false, needsReview: true },
    );
    expect(issues.map((i) => [i.code, i.blocks, i.slot_keys])).toEqual([
      ["no_reference", "publish", []],
      ["needs_review", "publish", []],
      ["product_inactive", "publish", ["A2"]],
      ["label_duplicate", "save", ["A1", "a1"]],
      ["threshold", "save", ["a1"]],
      ["label_missing", "save", [""]],
      ["bounds", "save", [""]],
      ["target", "save", [""]],
      ["overlap", "publish", ["A1", "A2"]],
    ]);
    expect(layoutIssues([], { hasReference: true, needsReview: false }).map((i) => i.code)).toEqual(["no_slots"]);
  });
});
