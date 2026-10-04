import { createHash } from "node:crypto";
import { NormalizedRect } from "@display-refill/domain";
import { z } from "zod";
import type { Json } from "./database.types";
import type { DbClient } from "./supabase";
import { fail, fromDbError, ok } from "./result";
import { processReferenceImage } from "./pog-images";
import { scanDetail } from "./scans";

export const CreatePhoto = z.strictObject({ display_id: z.uuid(), source: z.literal("photo"), expected_pog_version_id: z.uuid() });
export const FinalizePhoto = z.strictObject({ expected_revision: z.int().positive(), crop: NormalizedRect });
type Payload = { scan: Parameters<typeof scanDetail>[0]; upload: { id: string; object_path: string; state: string; expires_at: string; max_bytes: number } };
export async function photoTransaction(service: DbClient, actor: string, action: "create" | "authorize" | "renew" | "finalize" | "reject", resource: string, input: Json, key?: string, image?: Json, requestId?: string) {
  const r = await service.rpc("photo_scan_workflow", { p_actor: actor, p_action: action, p_resource: resource, p_input: input, p_key: key, p_image: image, p_request_id: requestId });
  if (r.error?.message === "RATE_LIMITED") return fail("RATE_LIMITED", "At most ten new photo scans per minute. Retry shortly.", { retryAfterSeconds: 60 });
  if (r.error) return fromDbError(r.error);
  return ok(r.data as unknown as { payload: Payload; replayed: boolean });
}
export function photoResponse(result: { payload: Payload; replayed: boolean }) {
  const { scan, upload } = result.payload;
  return { scan: scanDetail(scan), upload: { upload_id: upload.id, upload_url: `/api/v1/scans/${scan.id}/image`, expires_at: upload.expires_at, max_bytes: upload.max_bytes }, analysis_available: true };
}
const invalid = (message: string) => fail("VALIDATION_FAILED", message, { fieldErrors: { file: [message] } });
/** Authenticate through the transaction before any privileged Storage operation. */
export async function uploadScanPhoto(service: DbClient, actor: string, id: string, request: Request) {
  const authorized = await photoTransaction(service, actor, "authorize", id, {});
  if (!authorized.ok) return authorized;
  const u = authorized.value.payload.upload;
  if (u.state !== "pending" || Date.parse(u.expires_at) <= Date.now()) return fail("CONFLICT", "Upload expired. Renew the upload and retry.");
  const reader = request.body?.getReader();
  if (!reader) return invalid("No image supplied.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > u.max_bytes) { await reader.cancel(); return invalid("Maximum upload is 10 MiB."); }
      chunks.push(value);
    }
  } catch { return fail("DEPENDENCY_UNAVAILABLE", "Upload interrupted. Retry the same photo."); }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  // MIME declarations are deliberately ignored. Decode actual bytes before staging.
  const valid = await processReferenceImage(bytes, { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
  if (!valid.ok) return invalid(valid.message);
  const storage = service.storage.from("display-scans");
  const written = await storage.upload(u.object_path, bytes, { contentType: "image/jpeg", upsert: false });
  if (written.error) {
    const existing = await storage.download(u.object_path);
    if (!existing.error && existing.data) return Buffer.from(await existing.data.arrayBuffer()).equals(bytes) ? ok({ uploaded: true }) : fail("CONFLICT", "A different photo already exists. Retake starts a new scan.");
    return fail("DEPENDENCY_UNAVAILABLE", "Storage unavailable. Retry.");
  }
  return ok({ uploaded: true });
}
export async function finalizeScanPhoto(service: DbClient, actor: string, id: string, input: z.infer<typeof FinalizePhoto>, key: string, requestId: string) {
  const authorized = await photoTransaction(service, actor, "authorize", id, {});
  if (!authorized.ok) return authorized;
  const u = authorized.value.payload.upload;
  // Lost-response replay must work after staging cleanup and intent expiry.
  if (u.state === "validated") return photoTransaction(service, actor, "finalize", id, input, key, {}, requestId);
  if (u.state !== "pending" || Date.parse(u.expires_at) <= Date.now()) return fail("CONFLICT", "Upload expired. Renew and retry.");
  if (authorized.value.payload.scan.revision !== input.expected_revision) return fail("CONFLICT", "Scan revision changed.");
  const storage = service.storage.from("display-scans");
  const downloaded = await storage.download(u.object_path);
  if (downloaded.error || !downloaded.data) return fail("DEPENDENCY_UNAVAILABLE", "Photo not uploaded. Retry upload first.");
  const processed = await processReferenceImage(new Uint8Array(await downloaded.data.arrayBuffer()), { rotation: 0, crop: input.crop });
  if (!processed.ok) {
    // Invalid bytes cannot produce a valid competing crop. Tiny crop errors keep
    // the write-once staging photo for correction/retry instead.
    if (processed.reason !== "crop_too_small") {
      const rejected = await photoTransaction(service, actor, "reject", id, {});
      if (rejected.ok) await storage.remove([u.object_path]);
    }
    return invalid(processed.message);
  }
  const hash = createHash("sha256").update(processed.jpeg).digest("hex");
  const path = u.object_path.replace(/capture\.jpg$/, `validated-${hash}.jpg`);
  const written = await storage.upload(path, processed.jpeg, { contentType: "image/jpeg", upsert: false });
  if (written.error) {
    const existing = await storage.download(path);
    if (existing.error || !existing.data || createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex") !== hash) return fail("DEPENDENCY_UNAVAILABLE", "Storage unavailable. Retry finalization.");
  }
  const result = await photoTransaction(service, actor, "finalize", id, input, key, { sha256: hash, width: processed.width, height: processed.height, source: processed.source }, requestId);
  if (result.ok) await storage.remove([u.object_path]);
  return result;
}
