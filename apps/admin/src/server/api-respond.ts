import "server-only";
import { jsonData, jsonFailure, type ServiceResult } from "@display-refill/server";

/**
 * Sends a (possibly replayed) idempotent response. Stored bodies keep the
 * original request_id; replays are marked with `idempotent-replayed: true`.
 */
export function replay(stored: { status: number; body: unknown; replayed: boolean }, requestId: string): Response {
  const headers = stored.replayed ? { "idempotent-replayed": "true" } : undefined;
  const body = stored.body as { data?: unknown; request_id?: string };
  if (stored.status < 400 && body && "data" in body) {
    return jsonData(body.data, body.request_id ?? requestId, { status: stored.status, headers });
  }
  return Response.json(stored.body, {
    status: stored.status,
    headers: { "cache-control": "no-store", "x-request-id": requestId, ...headers },
  });
}

/** A ServiceResult as a route-handler outcome: failures become the error envelope. */
export function jsonFailureOutcome<T>(result: ServiceResult<T>, requestId: string): { ok: true; value: T } | { ok: false; response: Response } {
  return result.ok ? result : { ok: false, response: jsonFailure(result, requestId) };
}
