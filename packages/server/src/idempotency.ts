import { createHash } from "node:crypto";
import type { Json } from "./database.types";
import { fail, type ServiceResult } from "./result";
import type { DbClient } from "./supabase";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

export interface StoredResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

/** Stable JSON (sorted keys) so the same request always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function requestHash(routeScope: string, body: unknown): string {
  return createHash("sha256").update(`${routeScope}\n${canonical(body)}`).digest("hex");
}

export function parseIdempotencyKey(headers: Headers): ServiceResult<string> {
  const key = headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key) {
    return fail("VALIDATION_FAILED", "Idempotency-Key header is required.", { fieldErrors: { "Idempotency-Key": ["is required"] } });
  }
  if (!KEY_PATTERN.test(key)) {
    return fail("VALIDATION_FAILED", "Idempotency-Key is invalid.", { fieldErrors: { "Idempotency-Key": ["must be 8–200 characters: letters, digits, _ . : -"] } });
  }
  return { ok: true, value: key };
}

/**
 * Runs `execute` at most once per (actor, route scope, key) within 24 hours.
 * A repeat with the same body returns the stored response; a different body
 * or a request still in flight returns 409. Responses with status >= 500 or
 * 429 are not stored, so the client may retry with the same key.
 */
export async function withIdempotency(
  service: DbClient,
  scope: { actorId: string; routeScope: string; key: string; body: unknown },
  execute: () => Promise<{ status: number; body: unknown; resourceId?: string }>,
): Promise<ServiceResult<StoredResponse>> {
  const hash = requestHash(scope.routeScope, scope.body);
  const match = { actor_id: scope.actorId, route_scope: scope.routeScope, key: scope.key };

  // An expired record no longer protects anything; clear it so the key can be reused.
  const expired = await service.from("idempotency_records").delete().match(match).lt("expires_at", new Date().toISOString());
  if (expired.error) return fail("DEPENDENCY_UNAVAILABLE", "The database is unavailable. Try again shortly.");

  const claim = await service.from("idempotency_records").insert({ ...match, request_hash: hash }).select("id").single();
  if (claim.error) {
    if (claim.error.code !== "23505") return fail("DEPENDENCY_UNAVAILABLE", "The database is unavailable. Try again shortly.");
    const existing = await service
      .from("idempotency_records")
      .select("request_hash, response_status, response_body")
      .match(match)
      .maybeSingle();
    if (existing.error || !existing.data) return fail("CONFLICT", "This Idempotency-Key is being processed. Retry shortly.");
    if (existing.data.request_hash !== hash) {
      return fail("CONFLICT", "This Idempotency-Key was already used with a different request.");
    }
    if (existing.data.response_status === null) {
      return fail("CONFLICT", "A request with this Idempotency-Key is still in progress. Retry shortly.");
    }
    return { ok: true, value: { status: existing.data.response_status, body: existing.data.response_body, replayed: true } };
  }

  let result: { status: number; body: unknown; resourceId?: string };
  try {
    result = await execute();
  } catch (error) {
    await service.from("idempotency_records").delete().eq("id", claim.data.id);
    throw error;
  }
  if (result.status >= 500 || result.status === 429) {
    await service.from("idempotency_records").delete().eq("id", claim.data.id);
  } else {
    await service
      .from("idempotency_records")
      .update({ response_status: result.status, response_body: result.body as Json, resource_id: result.resourceId ?? null })
      .eq("id", claim.data.id);
  }
  return { ok: true, value: { status: result.status, body: result.body, replayed: false } };
}
