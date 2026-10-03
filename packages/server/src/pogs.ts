import { createHash } from "node:crypto";
import {
  type CreatePogVersionRequest,
  type FinalizePogImageRequest,
  type LayoutIssue,
  layoutIssues,
  type PogImageAccess,
  type PogUploadIntent,
  type PogVersionDetail,
  type PogVersionSlot,
  type PublishPogVersionRequest,
  REFERENCE_IMAGE,
  type ReplaceSlotsRequest,
} from "@display-refill/domain";
import type { Json } from "./database.types";
import type { Logger } from "./logger";
import { processReferenceImage } from "./pog-images";
import { fail, fromDbError, ok, type ServiceResult } from "./result";
import type { DbClient } from "./supabase";

/**
 * POG builder and publication (feature 05).
 *
 * Reads use the caller-scoped client, so RLS decides which versions are
 * visible (admins: drafts too; managers: published; employees: versions their
 * stores use). Writes call service-role-only functions that lock the stored
 * version, derive its organization, re-check that the verified actor is an
 * organization admin and enforce the expected revision. Publication rules are
 * enforced again by the pog_versions trigger for every role.
 */

const BUCKET = "pog-images";
const iso = (value: string) => new Date(value).toISOString();
const isoOrNull = (value: string | null | undefined) => (value ? iso(value) : null);

const VERSION_COLUMNS = `id, organization_id, pog_id, version_number, state, revision, created_at, updated_at, published_at, source_version_id,
  reference_path, reference_width, reference_height, reference_validated_at, slots_need_review,
  pogs(id, name, archived),
  pog_slots(id, label, product_id, x, y, width, height, target_quantity, refill_threshold, sort_order,
    products!pog_slots_organization_id_product_id_fkey(id, name, short_name, active))`;

type VersionRow = {
  id: string; organization_id: string; pog_id: string; version_number: number; state: string; revision: number;
  created_at: string; updated_at: string; published_at: string | null; source_version_id: string | null;
  reference_path: string | null; reference_width: number | null; reference_height: number | null; reference_validated_at: string | null;
  slots_need_review: boolean;
  pogs: { id: string; name: string; archived: boolean } | null;
  pog_slots: Array<{
    id: string; label: string; product_id: string; x: number; y: number; width: number; height: number;
    target_quantity: number; refill_threshold: number | null; sort_order: number;
    products: { id: string; name: string; short_name: string; active: boolean } | null;
  }>;
};

/** Publication blockers of a draft, keyed by slot ID (none for published versions). */
export function publishBlockers(detail: Pick<PogVersionDetail, "state" | "reference" | "slots_need_review" | "slots">): LayoutIssue[] {
  if (detail.state !== "draft") return [];
  return layoutIssues(
    detail.slots.map((s) => ({ ...s, key: s.slot_id })),
    { hasReference: detail.reference !== null, needsReview: detail.slots_need_review },
  );
}

function toDetail(row: VersionRow, draftVersionId: string | null): PogVersionDetail {
  const slots: PogVersionSlot[] = [...row.pog_slots]
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .map((s) => ({
      slot_id: s.id,
      label: s.label,
      product_id: s.product_id,
      product_name: s.products?.name ?? "",
      product_short_name: s.products?.short_name ?? "",
      product_active: s.products?.active ?? false,
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
      target_quantity: s.target_quantity,
      refill_threshold: s.refill_threshold,
      sort_order: s.sort_order,
    }));
  const reference =
    row.reference_path && row.reference_width && row.reference_height && row.reference_validated_at
      ? { width: row.reference_width, height: row.reference_height, validated_at: iso(row.reference_validated_at) }
      : null;
  const detail = {
    pog_version_id: row.id,
    pog_id: row.pog_id,
    organization_id: row.organization_id,
    pog_name: row.pogs?.name ?? "",
    pog_archived: row.pogs?.archived ?? false,
    version_number: row.version_number,
    state: row.state as PogVersionDetail["state"],
    revision: row.revision,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    published_at: isoOrNull(row.published_at),
    source_version_id: row.source_version_id,
    reference,
    slots_need_review: row.slots_need_review,
    slots,
    draft_version_id: draftVersionId,
  };
  return { ...detail, publish_blockers: publishBlockers(detail) };
}

/**
 * One version as `client` may see it. With a caller-scoped client this is
 * the RLS-filtered view; `pogId`, when given, must match.
 */
export async function getPogVersion(client: DbClient, versionId: string, pogId?: string): Promise<ServiceResult<PogVersionDetail>> {
  let query = client.from("pog_versions").select(VERSION_COLUMNS).eq("id", versionId);
  if (pogId) query = query.eq("pog_id", pogId);
  const { data, error } = await query.maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail("NOT_FOUND", "POG version not found.");
  const row = data as unknown as VersionRow;
  const draft = await client.from("pog_versions").select("id").eq("pog_id", row.pog_id).eq("state", "draft").limit(1).maybeSingle();
  if (draft.error) return fromDbError(draft.error);
  return ok(toDetail(row, draft.data?.id ?? null));
}

/** Product choices for the editor: the organization catalog (admins see archived ones too). */
export async function listProductOptions(client: DbClient, organizationId: string) {
  const { data, error } = await client
    .from("products")
    .select("id, name, short_name, active")
    .eq("organization_id", organizationId)
    .order("name")
    .order("id")
    .limit(1000);
  if (error) return fromDbError(error);
  return ok(data.map((p) => ({ product_id: p.id, name: p.name, short_name: p.short_name, active: p.active })));
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** Next draft of a POG: a copy of a published version (slots and reference image) or blank. */
export async function createPogVersion(service: DbClient, actorId: string, pogId: string, input: CreatePogVersionRequest, requestId: string): Promise<ServiceResult<PogVersionDetail>> {
  const { data, error } = await service.rpc("create_pog_version", {
    p_actor: actorId,
    p_pog_id: pogId,
    p_source_version_id: input.source_version_id ?? undefined,
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return getPogVersion(service, data.id);
}

/**
 * Replaces the complete slot set of a draft. The database function checks
 * the actor, state, revision and every slot; on a validation failure (which
 * it only raises after authorizing the actor) the products are rechecked
 * here to name the exact slot fields.
 */
export async function replacePogSlots(service: DbClient, actorId: string, versionId: string, input: ReplaceSlotsRequest, requestId: string): Promise<ServiceResult<PogVersionDetail>> {
  const { data, error } = await service.rpc("replace_pog_slots", {
    p_actor: actorId,
    p_version_id: versionId,
    p_expected_revision: input.expected_revision,
    p_slots: input.slots as unknown as Json,
    p_confirm_coordinates: input.confirm_coordinates ?? false,
    p_request_id: requestId,
  });
  if (error) {
    const failure = fromDbError(error);
    if (failure.code !== "VALIDATION_FAILED") return failure;
    const products = await productFieldErrors(service, versionId, input);
    return Object.keys(products).length ? { ...failure, fieldErrors: products } : failure;
  }
  return getPogVersion(service, data.id);
}

async function productFieldErrors(service: DbClient, versionId: string, input: ReplaceSlotsRequest): Promise<Record<string, string[]>> {
  const version = await service.from("pog_versions").select("organization_id").eq("id", versionId).maybeSingle();
  if (version.error || !version.data) return {};
  const ids = [...new Set(input.slots.map((s) => s.product_id))];
  const found = await service.from("products").select("id").eq("organization_id", version.data.organization_id).in("id", ids);
  if (found.error) return {};
  const known = new Set(found.data.map((p) => p.id));
  const errors: Record<string, string[]> = {};
  input.slots.forEach((s, i) => {
    if (!known.has(s.product_id)) errors[`slots.${i}.product_id`] = ["choose a product from this organization"];
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

/**
 * Publishes a draft atomically (publish_pog_version + the validation
 * trigger). Publication does not assign the version to any display.
 */
export async function publishPogVersion(service: DbClient, actorId: string, versionId: string, input: PublishPogVersionRequest, requestId: string): Promise<ServiceResult<PogVersionDetail>> {
  const authorized = await authorizeReferenceWrite(service, actorId, versionId, input.expected_revision);
  if (!authorized.ok) return authorized;
  const reference = await service.from("pog_versions").select("reference_path, reference_validated_at").eq("id", versionId).single();
  if (reference.error) return fromDbError(reference.error);
  if (reference.data.reference_path && reference.data.reference_validated_at) {
    const object = await service.storage.from(BUCKET).download(reference.data.reference_path);
    if (object.error || !object.data) return fail("VALIDATION_FAILED", "The validated reference image is unavailable. Upload it again before publishing.", { fieldErrors: { reference_image: ["reference image file is missing or unavailable"] } });
  }
  const { data, error } = await service.rpc("publish_pog_version", {
    p_actor: actorId,
    p_version_id: versionId,
    p_expected_revision: input.expected_revision,
    p_request_id: requestId,
  });
  if (error) {
    const failure = fromDbError(error);
    if (failure.code !== "VALIDATION_FAILED") return failure;
    // Raised only after the function authorized the actor: list every blocker.
    const detail = await getPogVersion(service, versionId);
    if (!detail.ok || detail.value.publish_blockers.length === 0) return failure;
    const fieldErrors: Record<string, string[]> = { ...failure.fieldErrors };
    for (const issue of detail.value.publish_blockers) {
      const field = issue.code === "no_reference" ? "reference_image" : "slots";
      fieldErrors[field] = [...new Set([...(fieldErrors[field] ?? []), issue.message])];
    }
    return { ...failure, message: "This draft cannot be published yet.", fieldErrors };
  }
  return getPogVersion(service, data.id);
}

// ---------------------------------------------------------------------------
// Reference images
// ---------------------------------------------------------------------------

/**
 * A write-once staging path plus an authenticated API upload URL. The
 * ten-minute intent is bound to the verified actor and exact object path.
 */
export async function createPogUploadIntent(service: DbClient, actorId: string, versionId: string, requestId: string, appOrigin: string): Promise<ServiceResult<PogUploadIntent>> {
  const { data, error } = await service.rpc("create_pog_upload_intent", { p_actor: actorId, p_version_id: versionId, p_request_id: requestId });
  if (error) return fromDbError(error);
  // Supabase signed upload tokens have a fixed two-hour lifetime. Route POG
  // bytes through our authenticated API to enforce the ten-minute grant,
  // current membership and write-once path without exposing such a token.
  return ok({
    upload_id: data.id,
    bucket: BUCKET,
    object_path: data.object_path,
    upload_url: `${appOrigin}/api/v1/pog-versions/${versionId}/uploads/${data.id}`,
    upload_method: "PUT",
    content_type: REFERENCE_IMAGE.contentType,
    max_bytes: data.max_bytes,
    expires_at: iso(data.expires_at),
  });
}

async function authorizeReferenceWrite(service: DbClient, actorId: string, versionId: string, revision?: number): Promise<ServiceResult<null>> {
  const version = await service.from("pog_versions").select("organization_id, state, revision").eq("id", versionId).maybeSingle();
  if (version.error) return fromDbError(version.error);
  if (!version.data) return fail("NOT_FOUND", "POG version not found.");
  const membership = await service.from("organization_memberships").select("role, active, organizations!inner(active)").eq("organization_id", version.data.organization_id).eq("user_id", actorId).maybeSingle();
  if (membership.error) return fromDbError(membership.error);
  if (!membership.data?.active || !membership.data.organizations.active) return fail("NOT_FOUND", "POG version not found.");
  if (membership.data.role !== "admin") return fail("FORBIDDEN", "Only organization admins upload reference images.");
  if (version.data.state !== "draft") return fail("CONFLICT", "Published POG versions cannot change.");
  if (revision !== undefined && version.data.revision !== revision) return fail("CONFLICT", "This draft changed. Reload the latest revision before saving.");
  return ok(null);
}

/** Authenticated write-once staging upload, bounded while streaming. */
export async function uploadPogReference(service: DbClient, actorId: string, versionId: string, uploadId: string, request: Request): Promise<ServiceResult<null>> {
  const authorized = await authorizeReferenceWrite(service, actorId, versionId);
  if (!authorized.ok) return authorized;
  const intent = await service.from("upload_intents").select("actor_id, object_path, state, expires_at, max_bytes").eq("id", uploadId).eq("resource_id", versionId).eq("bucket", BUCKET).maybeSingle();
  if (intent.error) return fromDbError(intent.error);
  if (!intent.data || intent.data.actor_id !== actorId) return fail("NOT_FOUND", "Upload not found.");
  const u = intent.data;
  if (u.state !== "pending" || Date.parse(u.expires_at) <= Date.now()) return fail("CONFLICT", "This upload expired or has already been finalized. Request another upload.");
  if (request.headers.get("content-type")?.split(";")[0] !== REFERENCE_IMAGE.contentType) return fileError("Upload a JPEG image.");
  const reader = request.body?.getReader();
  if (!reader) return fileError("No image bytes were supplied.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > u.max_bytes) {
        await reader.cancel();
        return fileError("The image is larger than 10 MB. Export a smaller JPEG.");
      }
      chunks.push(value);
    }
  } catch {
    return fileError("The upload was interrupted. Try again.");
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const written = await service.storage.from(BUCKET).upload(u.object_path, bytes, { contentType: REFERENCE_IMAGE.contentType, upsert: false });
  if (written.error) {
    // Repeating the exact bytes is safe after a lost response. Different
    // bytes cannot replace the object; finalization still validates content.
    const existing = await service.storage.from(BUCKET).download(u.object_path);
    if (!existing.error && existing.data) {
      if (Buffer.from(await existing.data.arrayBuffer()).equals(bytes)) return ok(null);
      return fail("CONFLICT", "This upload already contains a different image. Request another upload.");
    }
    return fail("DEPENDENCY_UNAVAILABLE", "Image storage is unavailable. Try again shortly.");
  }
  return ok(null);
}

const validatedPathOf = (stagingPath: string, hash: string) => stagingPath.replace(/\/upload-([0-9a-f-]{36})\.jpg$/, `/reference-$1-${hash}.jpg`);
const fileError = (message: string) => fail("VALIDATION_FAILED", "The image was not accepted.", { fieldErrors: { file: [message] } });
const uploadError = (message: string) => fail("VALIDATION_FAILED", "The upload cannot be used.", { fieldErrors: { upload_id: [message] } });

/**
 * Validates the uploaded staging object and makes the result the draft's
 * canonical reference: decode, orient, rotate, crop, re-encode without
 * metadata, write the validated object, record it transactionally, then
 * remove the staging upload. Rejected content is deleted and the upload
 * marked rejected; an expired upload is deleted and marked expired.
 */
export async function finalizePogImage(
  service: DbClient,
  actorId: string,
  versionId: string,
  input: FinalizePogImageRequest,
  requestId: string,
  logger?: Logger,
): Promise<ServiceResult<PogVersionDetail>> {
  // Authorize before privileged downloads, writes or cleanup, even for an
  // intent issued before membership revocation or publication.
  const authorized = await authorizeReferenceWrite(service, actorId, versionId, input.expected_revision);
  if (!authorized.ok) return authorized;

  const intent = await service
    .from("upload_intents")
    .select("id, actor_id, resource_id, bucket, object_path, state, expires_at, max_bytes")
    .eq("id", input.upload_id)
    .eq("resource_id", versionId)
    .eq("bucket", BUCKET)
    .maybeSingle();
  if (intent.error) return fromDbError(intent.error);
  // Grants are bound to the actor who requested them.
  if (!intent.data || intent.data.actor_id !== actorId) return uploadError("unknown upload for this draft");
  const u = intent.data;
  const storage = service.storage.from(BUCKET);
  const removeQuietly = async (path: string) => {
    const removed = await storage.remove([path]);
    if (removed.error) logger?.warn("pog image: object cleanup failed", { request_id: requestId, upload_id: u.id });
  };

  if (u.state !== "pending") return fail("CONFLICT", `This upload was already ${u.state}. Upload the image again if you need to change it.`);
  if (Date.parse(u.expires_at) <= Date.now()) {
    await service.rpc("settle_pog_upload", { p_actor: actorId, p_upload_id: u.id, p_state: "expired" });
    await removeQuietly(u.object_path);
    return uploadError("the upload expired; upload the image again");
  }

  const downloaded = await storage.download(u.object_path);
  if (downloaded.error || !downloaded.data) return fileError("No uploaded image was found. Upload the file, then try again.");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const processed = bytes.byteLength > u.max_bytes
    ? ({ ok: false, message: "The image is larger than 10 MB. Export a smaller JPEG and try again." } as const)
    : await processReferenceImage(bytes, { rotation: input.rotation, crop: input.crop });
  if (!processed.ok) {
    await service.rpc("settle_pog_upload", { p_actor: actorId, p_upload_id: u.id, p_state: "rejected" });
    await removeQuietly(u.object_path);
    logger?.info("pog image: upload rejected", { request_id: requestId, upload_id: u.id });
    return fileError(processed.message);
  }

  // Content-addressed, write-once output: concurrent finalizations of the
  // same upload with different crops never overwrite each other's pixels.
  // Keep unreferenced outputs for retention cleanup rather than deleting a
  // file that another in-flight transaction may be about to reference.
  const hash = createHash("sha256").update(processed.jpeg).digest("hex");
  const validatedPath = validatedPathOf(u.object_path, hash);
  const written = await storage.upload(validatedPath, processed.jpeg, { contentType: REFERENCE_IMAGE.contentType, upsert: false });
  if (written.error) {
    const existing = await storage.download(validatedPath);
    if (existing.error || !existing.data || createHash("sha256").update(new Uint8Array(await existing.data.arrayBuffer())).digest("hex") !== hash) {
      return fail("DEPENDENCY_UNAVAILABLE", "Image storage is unavailable. Try again shortly.");
    }
  }

  const { data, error } = await service.rpc("finalize_pog_reference", {
    p_actor: actorId,
    p_version_id: versionId,
    p_expected_revision: input.expected_revision,
    p_upload_id: u.id,
    p_sha256: hash,
    p_width: processed.width,
    p_height: processed.height,
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  await removeQuietly(u.object_path);
  return getPogVersion(service, data.id);
}

/**
 * A five-minute signed link to a version's reference image, issued only when
 * the caller can read that version (RLS: employees only for layouts their
 * stores use). Never persisted or logged.
 */
export async function pogImageAccess(caller: DbClient, service: DbClient, versionId: string): Promise<ServiceResult<PogImageAccess>> {
  const { data, error } = await caller
    .from("pog_versions")
    .select("id, reference_path, reference_width, reference_height, reference_validated_at")
    .eq("id", versionId)
    .maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail("NOT_FOUND", "POG version not found.");
  if (!data.reference_path || !data.reference_validated_at || !data.reference_width || !data.reference_height) {
    return fail("NOT_FOUND", "This version has no reference image.");
  }
  const signed = await service.storage.from(BUCKET).createSignedUrl(data.reference_path, REFERENCE_IMAGE.accessSeconds);
  if (signed.error || !signed.data) return fail("NOT_FOUND", "The reference image file is not available.");
  return ok({
    url: signed.data.signedUrl,
    expires_at: new Date(Date.now() + REFERENCE_IMAGE.accessSeconds * 1000).toISOString(),
    width: data.reference_width,
    height: data.reference_height,
  });
}
