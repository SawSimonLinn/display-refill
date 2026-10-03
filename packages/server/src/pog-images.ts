import { type ImageRotation, type NormalizedRect, REFERENCE_IMAGE } from "@display-refill/domain";
import sharp, { type Metadata } from "sharp";

/**
 * Server-side validation of POG reference uploads (storage-and-retention.md,
 * step 5). Client preprocessing is a convenience only; this is the boundary:
 *
 * 1. size ≤ 10 MiB and JPEG magic bytes;
 * 2. the decoded format is JPEG (not just the declared content type);
 * 3. at most 4096 px per edge and 16 megapixels;
 * 4. EXIF orientation applied, then the admin's quarter turn, so the result
 *    is upright;
 * 5. the selected display bounds are cropped out; this crop is the canonical
 *    reference every slot coordinate is normalized to;
 * 6. scaled to at most 2048 px on the long edge and re-encoded as a new JPEG
 *    without EXIF, GPS or other metadata.
 */

export type ReferenceImageResult =
  | { ok: true; jpeg: Buffer; width: number; height: number; source: { width: number; height: number } }
  | { ok: false; reason: "too_large" | "not_jpeg" | "malformed" | "dimensions" | "crop_too_small"; message: string };

const reject = (reason: Extract<ReferenceImageResult, { ok: false }>["reason"], message: string): ReferenceImageResult => ({ ok: false, reason, message });

export async function processReferenceImage(bytes: Uint8Array, options: { rotation: ImageRotation; crop: NormalizedRect }): Promise<ReferenceImageResult> {
  if (bytes.byteLength > REFERENCE_IMAGE.maxBytes) return reject("too_large", "The image is larger than 10 MB. Export a smaller JPEG and try again.");
  if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return reject("not_jpeg", "The file is not a JPEG image. Convert it to JPEG and try again.");
  }

  let meta: Metadata;
  try {
    // limitInputPixels guards the decoder before the explicit checks below.
    meta = await sharp(bytes, { limitInputPixels: REFERENCE_IMAGE.maxEdge * REFERENCE_IMAGE.maxEdge, failOn: "error" }).metadata();
  } catch {
    return reject("malformed", "The image could not be read. It may be damaged or too large; export it again as a JPEG.");
  }
  if (meta.format !== "jpeg") return reject("not_jpeg", "The file is not a JPEG image. Convert it to JPEG and try again.");
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1 || width > REFERENCE_IMAGE.maxEdge || height > REFERENCE_IMAGE.maxEdge || width * height > REFERENCE_IMAGE.maxPixels) {
    return reject("dimensions", "The image must be at most 4096 pixels on each side and 16 megapixels in total.");
  }

  // EXIF orientations 5–8 swap the axes; so do quarter turns of 90/270.
  const exifSwaps = (meta.orientation ?? 1) >= 5;
  const turnSwaps = options.rotation === 90 || options.rotation === 270;
  const [uprightW, uprightH] = exifSwaps !== turnSwaps ? [height, width] : [width, height];

  const left = Math.round(options.crop.x * uprightW);
  const top = Math.round(options.crop.y * uprightH);
  const cropW = Math.min(uprightW - left, Math.round(options.crop.width * uprightW));
  const cropH = Math.min(uprightH - top, Math.round(options.crop.height * uprightH));
  if (cropW < REFERENCE_IMAGE.minCropEdge || cropH < REFERENCE_IMAGE.minCropEdge) {
    return reject("crop_too_small", `The selected display area must be at least ${REFERENCE_IMAGE.minCropEdge} pixels on each side.`);
  }

  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: REFERENCE_IMAGE.maxEdge * REFERENCE_IMAGE.maxEdge, failOn: "error" })
      .autoOrient()
      .rotate(options.rotation)
      .extract({ left, top, width: cropW, height: cropH })
      .resize({ width: REFERENCE_IMAGE.outputLongEdge, height: REFERENCE_IMAGE.outputLongEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, jpeg: data, width: info.width, height: info.height, source: { width: uprightW, height: uprightH } };
  } catch {
    return reject("malformed", "The image could not be read. It may be damaged; export it again as a JPEG.");
  }
}
