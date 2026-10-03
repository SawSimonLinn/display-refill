"use client";

import { type ImageRotation, type PogUploadIntent, type PogVersionDetail, type Rect, REFERENCE_IMAGE } from "@display-refill/domain";
import { CircleCheck, ImageUp, RotateCcw, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { type ApiFailure, apiRequest, uploadReferenceImage } from "@/lib/api-client";
import { FailureNotice } from "../catalog/form-kit";
import { PercentField } from "./fields";
import { SlotCanvas } from "./slot-canvas";

const WHOLE: Rect = { x: 0, y: 0, width: 1, height: 1 };
const PREVIEW_EDGE = 1600;

interface Picked {
  /** Bytes to upload: the original JPEG when acceptable, else a browser-made JPEG. */
  blob: Blob;
  name: string;
  /** Upright (EXIF-applied) bitmap for the preview. */
  bitmap: ImageBitmap;
  transcoded: boolean;
}

/** Draws the bitmap turned clockwise by `rotation`, scaled to `maxEdge`. */
function drawRotated(bitmap: ImageBitmap, rotation: ImageRotation, maxEdge: number): HTMLCanvasElement {
  const swap = rotation === 90 || rotation === 270;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return canvas;
}

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));

/**
 * Choose, orient and crop a reference photo, then upload and validate it.
 *
 * The preview shows the photo upright (EXIF orientation applied, as the
 * server does) and turned by the chosen quarter turns; the rectangle selects
 * the display's bounds. The server repeats orientation, rotation and crop on
 * the uploaded bytes and is the only authority on what is accepted.
 */
export function ReferenceUpload({ version, replacing, blockedReason }: { version: PogVersionDetail; replacing: boolean; blockedReason: string | null }) {
  const router = useRouter();
  const inputId = useId();
  const statusId = useId();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState(4 / 3);
  const [rotation, setRotation] = useState<ImageRotation>(0);
  const [crop, setCrop] = useState<Rect>(WHOLE);
  const [phase, setPhase] = useState<"idle" | "reading" | "uploading" | "validating" | "done">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const finalizeKey = useRef<{ request: string; key: string } | null>(null);
  const uploadIntent = useRef<PogUploadIntent | null>(null);
  const bytesUploaded = useRef(false);
  const [invalidCrop, setInvalidCrop] = useState<Record<string, boolean>>({});
  const busy = phase === "reading" || phase === "uploading" || phase === "validating";

  async function showPreview(bitmap: ImageBitmap, turn: ImageRotation) {
    const canvas = drawRotated(bitmap, turn, PREVIEW_EDGE);
    const blob = await toJpeg(canvas);
    if (!blob) return;
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    setAspect(canvas.width / canvas.height);
  }

  async function choose(file: File | undefined) {
    setProblem(null);
    setFailure(null);
    setPhase("idle");
    if (!file) return;
    setPhase("reading");
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      setPhase("idle");
      setProblem("This file can’t be read in this browser. Export the photo as a JPEG (HEIC is not supported here) and choose it again.");
      return;
    }
    const fits = bitmap.width <= REFERENCE_IMAGE.maxEdge && bitmap.height <= REFERENCE_IMAGE.maxEdge && bitmap.width * bitmap.height <= REFERENCE_IMAGE.maxPixels;
    let blob: Blob | null = file;
    let transcoded = false;
    if (file.type !== "image/jpeg" || file.size > REFERENCE_IMAGE.maxBytes || !fits) {
      // Convert to an upright JPEG no larger than the stored reference.
      blob = await toJpeg(drawRotated(bitmap, 0, REFERENCE_IMAGE.outputLongEdge));
      transcoded = true;
    }
    if (!blob || blob.size > REFERENCE_IMAGE.maxBytes) {
      setPhase("idle");
      setProblem("The image is too large to upload. Export a smaller JPEG and try again.");
      return;
    }
    setPicked({ blob, name: file.name, bitmap, transcoded });
    setRotation(0);
    setCrop(WHOLE);
    finalizeKey.current = null;
    uploadIntent.current = null;
    bytesUploaded.current = false;
    setInvalidCrop({});
    await showPreview(bitmap, 0);
    setPhase("idle");
  }

  async function turn(delta: 90 | -90) {
    if (!picked) return;
    const next = (((rotation + delta) % 360) + 360) % 360 as ImageRotation;
    setRotation(next);
    setCrop(WHOLE); // a crop drawn for the old orientation no longer applies
    await showPreview(picked.bitmap, next);
  }

  async function upload() {
    if (!picked) return;
    setProblem(null);
    setFailure(null);
    setPhase("uploading");
    const intent = uploadIntent.current ? { ok: true as const, data: uploadIntent.current } : await apiRequest<PogUploadIntent>(`/pog-versions/${version.pog_version_id}/upload-intent`, { method: "POST" });
    if (!intent.ok) {
      setFailure(intent.failure);
      setPhase("idle");
      return;
    }
    uploadIntent.current = intent.data;
    const sent = bytesUploaded.current ? { ok: true as const, data: null } : await uploadReferenceImage(intent.data.upload_url, picked.blob);
    if (!sent.ok) {
      if (sent.failure.kind === "conflict") { uploadIntent.current = null; bytesUploaded.current = false; }
      setFailure(sent.failure);
      setPhase("idle");
      return;
    }
    bytesUploaded.current = true;
    setPhase("validating");
    const body = { upload_id: intent.data.upload_id, expected_revision: version.revision, rotation, crop };
    const request = JSON.stringify(body);
    if (finalizeKey.current?.request !== request) finalizeKey.current = { request, key: crypto.randomUUID() };
    const done = await apiRequest<PogVersionDetail>(`/pog-versions/${version.pog_version_id}/finalize-image`, {
      method: "POST",
      idempotencyKey: finalizeKey.current.key,
      body,
    });
    if (!done.ok) {
      const fileMessage = done.failure.fieldErrors.file ?? done.failure.fieldErrors.upload_id;
      if (fileMessage) {
        setProblem(fileMessage.join(" "));
        uploadIntent.current = null;
        bytesUploaded.current = false;
      }
      else setFailure(done.failure);
      setPhase("idle");
      return;
    }
    setPhase("done");
    setPicked(null);
    router.refresh();
  }

  const status =
    phase === "reading" ? "Reading the image…" : phase === "uploading" ? "Uploading the image…" : phase === "validating" ? "Checking, orienting and cropping the image on the server…" : phase === "done" ? "Reference image saved." : "";

  return (
    <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 id={`${inputId}-title`} className="text-lg font-semibold">
          {replacing ? "Replace the reference image" : "Reference image"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Use a straight-on photo of the whole display. Turn it upright if needed, then drag the rectangle to the display’s edges: that crop becomes the canonical
          image every slot position is measured against. Positions are relative to this crop and do not correct for camera angle or perspective in later scan photos.
          JPEG, PNG or WebP; the server stores a JPEG of at most {REFERENCE_IMAGE.outputLongEdge} px without location data.
        </p>
        {replacing && version.slots.length > 0 ? (
          <p className="text-sm font-medium">Replacing the image keeps the slots, but you must check every slot against the new image before you can publish.</p>
        ) : null}
      </div>

      {blockedReason ? (
        <p className="text-sm">{blockedReason}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={inputId} className="font-medium">
              Photo file
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => void choose(e.target.files?.[0])}
              className="text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:font-medium"
            />
          </div>

          {picked && previewUrl ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void turn(-90)} disabled={busy} className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-60">
                  <RotateCcw aria-hidden className="size-4" /> Rotate left
                </button>
                <button type="button" onClick={() => void turn(90)} disabled={busy} className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-60">
                  <RotateCw aria-hidden className="size-4" /> Rotate right
                </button>
                <button type="button" onClick={() => setCrop(WHOLE)} disabled={busy} className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-60">
                  Use the whole image
                </button>
              </div>
              <SlotCanvas
                imageUrl={previewUrl}
                aspect={aspect}
                label="Display bounds on the chosen photo"
                maxHeight="55vh"
                rects={[{ key: "crop", rect: crop, label: "Display", description: `Display bounds: left ${pct(crop.x)}, top ${pct(crop.y)}, width ${pct(crop.width)}, height ${pct(crop.height)}` }]}
                selectedKey="crop"
                onChange={(_key, rect) => setCrop(rect)}
                onCreate={(rect) => setCrop(rect)}
                readOnly={busy}
              />
              <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <legend className="mb-2 text-sm font-medium">Display bounds</legend>
                <PercentField onValidityChange={(invalid) => setInvalidCrop((old) => ({ ...old, left: invalid }))} label="Left" value={crop.x} min={0} max={100} maxExclusive onCommit={(x) => setCrop({ ...crop, x })} errors={crop.x + crop.width > 1.0000001 ? ["Left + width exceeds 100 %."] : undefined} />
                <PercentField onValidityChange={(invalid) => setInvalidCrop((old) => ({ ...old, top: invalid }))} label="Top" value={crop.y} min={0} max={100} maxExclusive onCommit={(y) => setCrop({ ...crop, y })} errors={crop.y + crop.height > 1.0000001 ? ["Top + height exceeds 100 %."] : undefined} />
                <PercentField onValidityChange={(invalid) => setInvalidCrop((old) => ({ ...old, width: invalid }))} label="Width" value={crop.width} min={0} minExclusive max={100} onCommit={(width) => setCrop({ ...crop, width })} />
                <PercentField onValidityChange={(invalid) => setInvalidCrop((old) => ({ ...old, height: invalid }))} label="Height" value={crop.height} min={0} minExclusive max={100} onCommit={(height) => setCrop({ ...crop, height })} />
              </fieldset>
              {picked.transcoded ? <p className="text-sm text-muted-foreground">This file will be converted to an upright JPEG in your browser before upload.</p> : null}
              <button
                type="button"
                onClick={() => void upload()}
                disabled={busy || Object.values(invalidCrop).some(Boolean) || crop.x + crop.width > 1.0000001 || crop.y + crop.height > 1.0000001}
                className="flex min-h-10 items-center gap-2 self-start rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60"
              >
                <ImageUp aria-hidden className="size-4" />
                {busy ? "Working…" : replacing ? "Upload and replace" : "Upload and validate"}
              </button>
            </div>
          ) : null}
        </>
      )}

      <p id={statusId} role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
        {phase === "done" ? <CircleCheck aria-hidden className="size-4 text-success" /> : null}
        {status}
      </p>
      {problem ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          {problem}
        </p>
      ) : null}
      <FailureNotice failure={failure} what="draft" />
    </section>
  );
}

const pct = (v: number) => `${Number((v * 100).toFixed(2))} %`;
