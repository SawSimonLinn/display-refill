/**
 * Geometry of POG slot rectangles (feature 05).
 *
 * Coordinates are normalized to the upright canonical reference crop: top-left
 * origin, x/y increasing right/down, 0 <= x,y < 1, 0 < width,height <= 1,
 * x + width <= 1, y + height <= 1. They are resolution independent, so the
 * same slot lands on the same part of the reference at any zoom or viewport.
 * They do not correct for camera angle, perspective or depth in scan photos
 * (vision-contract.md, current-issues R02).
 *
 * Checks run in integer micro-units (1e-6), the precision the API accepts, so
 * floating-point sums such as 0.1 + 0.2 cannot make a valid rectangle look
 * out of bounds or two touching rectangles look overlapping.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A box in CSS pixels (e.g. from getBoundingClientRect). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** API precision: at most six decimal places. */
export const COORDINATE_SCALE = 1_000_000;
/** Editor precision: 0.01 % steps, so edits never produce long decimals. */
export const EDITOR_SCALE = 10_000;
/** Smallest slot the editor creates by dragging (0.5 % of each edge). */
export const MIN_SLOT_SIZE = 0.005;

export const micro = (value: number) => Math.round(value * COORDINATE_SCALE);

/** True when the value has at most six decimal places. */
export const hasCoordinatePrecision = (value: number) => Number.isFinite(value) && Math.abs(value * COORDINATE_SCALE - micro(value)) < 1e-6;

/** Every normalized-rectangle rule from data-model.md. */
export function isInsideCrop(r: Rect): boolean {
  const [x, y, w, h] = [micro(r.x), micro(r.y), micro(r.width), micro(r.height)];
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x < COORDINATE_SCALE && y < COORDINATE_SCALE && x + w <= COORDINATE_SCALE && y + h <= COORDINATE_SCALE;
}

/** Positive-area overlap. Rectangles that only touch do not overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const [ax, ay, aw, ah] = [micro(a.x), micro(a.y), micro(a.width), micro(a.height)];
  const [bx, by, bw, bh] = [micro(b.x), micro(b.y), micro(b.width), micro(b.height)];
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

// ---------------------------------------------------------------------------
// Editor operations. All results are rounded to EDITOR_SCALE and kept inside
// the crop with at least MIN_SLOT_SIZE per edge.
// ---------------------------------------------------------------------------

const units = (v: number) => Math.round(v * EDITOR_SCALE);
const fromUnits = (u: number) => u / EDITOR_SCALE;
const clampUnits = (u: number, min: number, max: number) => Math.min(max, Math.max(min, u));
const MIN_UNITS = units(MIN_SLOT_SIZE);
const FULL = EDITOR_SCALE;

function fromUnitRect(x: number, y: number, w: number, h: number): Rect {
  return { x: fromUnits(x), y: fromUnits(y), width: fromUnits(w), height: fromUnits(h) };
}

/** Rounds to editor precision and pulls the rectangle inside the crop. */
export function clampRect(r: Rect): Rect {
  const w = clampUnits(units(r.width), MIN_UNITS, FULL);
  const h = clampUnits(units(r.height), MIN_UNITS, FULL);
  return fromUnitRect(clampUnits(units(r.x), 0, FULL - w), clampUnits(units(r.y), 0, FULL - h), w, h);
}

/** Moves without resizing; stops at the crop edges. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy });
}

/** The rectangle spanned by two points (e.g. a drag), clamped to the crop. */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x0 = clampUnits(units(Math.min(a.x, b.x)), 0, FULL);
  const y0 = clampUnits(units(Math.min(a.y, b.y)), 0, FULL);
  const x1 = clampUnits(units(Math.max(a.x, b.x)), 0, FULL);
  const y1 = clampUnits(units(Math.max(a.y, b.y)), 0, FULL);
  return fromUnitRect(x0, y0, x1 - x0, y1 - y0);
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Drags the edges named by `handle` to `point`; the opposite edges stay put. */
export function resizeRect(r: Rect, handle: ResizeHandle, point: Point): Rect {
  let x0 = units(r.x);
  let y0 = units(r.y);
  let x1 = x0 + units(r.width);
  let y1 = y0 + units(r.height);
  const px = clampUnits(units(point.x), 0, FULL);
  const py = clampUnits(units(point.y), 0, FULL);
  if (handle.includes("w")) x0 = Math.min(px, x1 - MIN_UNITS);
  if (handle.includes("e")) x1 = Math.max(px, x0 + MIN_UNITS);
  if (handle.includes("n")) y0 = Math.min(py, y1 - MIN_UNITS);
  if (handle.includes("s")) y1 = Math.max(py, y0 + MIN_UNITS);
  x0 = clampUnits(x0, 0, FULL - MIN_UNITS);
  y0 = clampUnits(y0, 0, FULL - MIN_UNITS);
  x1 = clampUnits(x1, x0 + MIN_UNITS, FULL);
  y1 = clampUnits(y1, y0 + MIN_UNITS, FULL);
  return fromUnitRect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * Keyboard editing: arrows move by 1 % (0.1 % with Alt/Option); with Shift
 * they resize from the right/bottom edge (Right/Down grow, Left/Up shrink).
 * Returns null for keys it does not handle.
 */
export function nudgeRect(r: Rect, key: string, modifiers: { shift: boolean; alt: boolean }): Rect | null {
  const step = modifiers.alt ? 0.001 : 0.01;
  const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const d = delta[key];
  if (!d) return null;
  if (!modifiers.shift) return moveRect(r, d[0], d[1]);
  const w = clampUnits(units(r.width + d[0]), MIN_UNITS, FULL - units(r.x));
  const h = clampUnits(units(r.height + d[1]), MIN_UNITS, FULL - units(r.y));
  return fromUnitRect(units(r.x), units(r.y), w, h);
}

/**
 * The part of `box` an image with aspect ratio `aspect` (width / height)
 * actually covers when scaled to fit (object-fit: contain), i.e. the box
 * minus any letterbox bars. Pointer positions must be measured against this,
 * not the element box, or slots drift whenever the element's shape differs
 * from the image's.
 */
export function containedRect(box: Box, aspect: number): Box {
  if (!(aspect > 0) || box.width <= 0 || box.height <= 0) return { ...box, width: 0, height: 0 };
  if (box.width / box.height > aspect) {
    const width = box.height * aspect;
    return { left: box.left + (box.width - width) / 2, top: box.top, width, height: box.height };
  }
  const height = box.width / aspect;
  return { left: box.left, top: box.top + (box.height - height) / 2, width: box.width, height };
}

/** A client (CSS pixel) position as a normalized point on the image content, clamped to the crop. */
export function toNormalizedPoint(clientX: number, clientY: number, content: Box): Point {
  if (content.width <= 0 || content.height <= 0) return { x: 0, y: 0 };
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp01((clientX - content.left) / content.width), y: clamp01((clientY - content.top) / content.height) };
}

/** A normalized rectangle in CSS pixels on the image content (for tests and hit areas). */
export function toClientBox(r: Rect, content: Box): Box {
  return { left: content.left + r.x * content.width, top: content.top + r.y * content.height, width: r.width * content.width, height: r.height * content.height };
}

/**
 * Where "Add slot" puts a new slot of the given size: the first position on a
 * 1 % grid (top to bottom, left to right) that overlaps nothing, or null.
 */
export function findFreeSpot(existing: Rect[], size: { width: number; height: number }): Rect | null {
  const w = units(size.width);
  const h = units(size.height);
  const step = units(0.01);
  for (let y = 0; y + h <= FULL; y += step) {
    for (let x = 0; x + w <= FULL; x += step) {
      const candidate = fromUnitRect(x, y, w, h);
      if (!existing.some((r) => rectsOverlap(r, candidate))) return candidate;
    }
  }
  return null;
}
