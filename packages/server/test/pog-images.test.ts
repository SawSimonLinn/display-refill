import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processReferenceImage } from "../src";

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const WHOLE = { x: 0, y: 0, width: 1, height: 1 };

/** A JPEG whose left half is red and right half blue, optionally with EXIF orientation and metadata. */
async function halves(width: number, height: number, exif?: { orientation?: number; copyright?: string }) {
  const half = await sharp({ create: { width: Math.floor(width / 2), height, channels: 3, background: BLUE } }).png().toBuffer();
  let image = sharp({ create: { width, height, channels: 3, background: RED } }).composite([{ input: half, left: width - Math.floor(width / 2), top: 0 }]);
  if (exif?.orientation) image = image.withMetadata({ orientation: exif.orientation });
  if (exif?.copyright) image = image.withExif({ IFD0: { Copyright: exif.copyright } });
  return image.jpeg({ quality: 95 }).toBuffer();
}

async function colorAt(jpeg: Buffer, x: number, y: number) {
  const px = await sharp(jpeg).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
  return px[0]! > 128 && px[2]! < 128 ? "red" : px[2]! > 128 && px[0]! < 128 ? "blue" : "other";
}

describe("processReferenceImage", () => {
  it("keeps an upright JPEG as is, re-encoded without metadata", async () => {
    const input = await halves(400, 200, { copyright: "Example" });
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processReferenceImage(input, { rotation: 0, crop: WHOLE });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([out.width, out.height]).toEqual([400, 200]);
    expect(await colorAt(out.jpeg, 10, 100)).toBe("red");
    expect(await colorAt(out.jpeg, 390, 100)).toBe("blue");
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("applies EXIF orientation so the stored reference is upright", async () => {
    // Orientation 6: the camera stored the pixels rotated; viewers turn them 90° clockwise.
    const input = await halves(400, 200, { orientation: 6 });
    const out = await processReferenceImage(input, { rotation: 0, crop: WHOLE });
    if (!out.ok) throw new Error(out.message);
    expect([out.width, out.height]).toEqual([200, 400]);
    expect(await colorAt(out.jpeg, 100, 10)).toBe("red"); // stored left half → displayed top
    expect(await colorAt(out.jpeg, 100, 390)).toBe("blue");
    expect((await sharp(out.jpeg).metadata()).orientation).toBeUndefined();
    expect(out.source).toEqual({ width: 200, height: 400 });
  });

  it("applies the admin's quarter turn after EXIF orientation", async () => {
    const input = await halves(400, 200);
    const out = await processReferenceImage(input, { rotation: 270, crop: WHOLE });
    if (!out.ok) throw new Error(out.message);
    expect([out.width, out.height]).toEqual([200, 400]);
    expect(await colorAt(out.jpeg, 100, 390)).toBe("red"); // left turned counter-clockwise → bottom
  });

  it("combines camera orientation with the admin quarter turn before selecting the crop", async () => {
    const input = await halves(400, 200, { orientation: 6 });
    const out = await processReferenceImage(input, { rotation: 90, crop: { x: 0, y: 0, width: 0.5, height: 1 } });
    if (!out.ok) throw new Error(out.message);
    expect([out.width, out.height]).toEqual([200, 200]);
    // Two clockwise quarter turns put the original blue right half on the left.
    expect(await colorAt(out.jpeg, 100, 100)).toBe("blue");
  });

  it("crops to the selected display bounds, which become the canonical reference", async () => {
    const input = await halves(400, 200);
    const out = await processReferenceImage(input, { rotation: 0, crop: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } });
    if (!out.ok) throw new Error(out.message);
    expect([out.width, out.height]).toEqual([200, 100]);
    expect(await colorAt(out.jpeg, 5, 50)).toBe("blue");
    expect(await colorAt(out.jpeg, 195, 50)).toBe("blue");
  });

  it("scales a large crop to a 2048 px long edge, never up", async () => {
    const input = await halves(3000, 1500);
    const out = await processReferenceImage(input, { rotation: 0, crop: WHOLE });
    if (!out.ok) throw new Error(out.message);
    expect([out.width, out.height]).toEqual([2048, 1024]);
  });

  it("rejects non-JPEG content, damaged JPEGs, oversized images and tiny crops", async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: RED } }).png().toBuffer();
    expect(await processReferenceImage(png, { rotation: 0, crop: WHOLE })).toMatchObject({ ok: false, reason: "not_jpeg" });

    // JPEG magic bytes followed by garbage (a renamed or truncated file).
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    expect(await processReferenceImage(garbage, { rotation: 0, crop: WHOLE })).toMatchObject({ ok: false, reason: "malformed" });
    const truncated = (await halves(400, 200)).subarray(0, 600);
    expect((await processReferenceImage(truncated, { rotation: 0, crop: WHOLE })).ok).toBe(false);

    const wide = await sharp({ create: { width: 4100, height: 64, channels: 3, background: RED } }).jpeg().toBuffer();
    expect(await processReferenceImage(wide, { rotation: 0, crop: WHOLE })).toMatchObject({ ok: false, reason: "dimensions" });
    const area = await sharp({ create: { width: 4096, height: 4000, channels: 3, background: RED } }).jpeg({ quality: 10 }).toBuffer();
    expect(await processReferenceImage(area, { rotation: 0, crop: WHOLE })).toMatchObject({ ok: false, reason: "dimensions" });

    const small = await halves(400, 200);
    expect(await processReferenceImage(small, { rotation: 0, crop: { x: 0, y: 0, width: 0.1, height: 0.1 } })).toMatchObject({ ok: false, reason: "crop_too_small" });

    expect(await processReferenceImage(new Uint8Array(10 * 1024 * 1024 + 1), { rotation: 0, crop: WHOLE })).toMatchObject({ ok: false, reason: "too_large" });
  });
});

it("normalizes all eight EXIF orientations and crops relative to upright pixels", async () => {
  // asymmetric four-quadrant fixture catches mirrors as well as swapped dimensions
  const corners = ["red", "green", "blue", "yellow"];
  const tiles = await Promise.all(corners.map(background => sharp({ create: { width: 100, height: 100, channels: 3, background } }).png().toBuffer()));
  const base = await sharp({ create: { width: 200, height: 200, channels: 3, background: "black" } }).composite(tiles.map((input, i) => ({ input, left: i % 2 * 100, top: Math.floor(i / 2) * 100 }))).jpeg({ quality: 100 }).toBuffer();
  const topLeft = [0, 1, 3, 2, 0, 2, 3, 1];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const input = await sharp(base).withMetadata({ orientation }).jpeg({ quality: 100 }).toBuffer();
    const result = await processReferenceImage(input, { rotation: 0, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    if (!result.ok) throw new Error(result.message);
    expect([result.width,result.height]).toEqual([100,100]);
    const pixel = await sharp(result.jpeg).extract({ left: 50, top: 50, width: 1, height: 1 }).raw().toBuffer();
    const expected = await sharp(tiles[topLeft[orientation-1]!]!).extract({ left: 50, top: 50, width: 1, height: 1 }).raw().toBuffer();
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(pixel[channel]!-expected[channel]!)).toBeLessThan(12);
    expect((await sharp(result.jpeg).metadata()).exif).toBeUndefined();
  }
});
