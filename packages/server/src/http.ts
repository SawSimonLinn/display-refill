import { API_ERROR_STATUS, type ApiErrorCode, REQUEST_ID_HEADER } from "@display-refill/domain";
import { createLogger } from "./logger";
import { LogLevel } from "./config";
import type { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reuses a well-formed client request ID, otherwise issues a new one. */
export function resolveRequestId(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER)?.trim();
  return supplied && UUID.test(supplied) ? supplied.toLowerCase() : crypto.randomUUID();
}

function logResponse(requestId: string, status: number, code?: string) {
  const level = LogLevel.safeParse(process.env.LOG_LEVEL);
  createLogger("admin-api", level.success ? level.data : "info").info("api response", {
    request_id: requestId, status, error_code: code,
  });
}

/** User-specific API responses must never enter shared caches. */
function baseHeaders(requestId: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

export function jsonData(data: unknown, requestId: string, init?: { status?: number; headers?: HeadersInit }): Response {
  logResponse(requestId, init?.status ?? 200);
  return Response.json(
    { data, request_id: requestId },
    { status: init?.status ?? 200, headers: baseHeaders(requestId, init?.headers) },
  );
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  init?: { fieldErrors?: Record<string, string[]>; headers?: HeadersInit },
): Response {
  logResponse(requestId, API_ERROR_STATUS[code], code);
  return Response.json(
    { error: { code, message, field_errors: init?.fieldErrors ?? {} }, request_id: requestId },
    { status: API_ERROR_STATUS[code], headers: baseHeaders(requestId, init?.headers) },
  );
}

/**
 * CSRF protection for cookie-authenticated mutations: the browser-supplied
 * Origin must equal the configured APP_ORIGIN. Without an Origin header,
 * only `Sec-Fetch-Site: same-origin` is accepted. Bearer-token requests do
 * not need this (the token is not ambient).
 */
export function isSameOriginRequest(headers: Headers, appOrigin: string): boolean {
  const origin = headers.get("origin");
  if (origin !== null) return origin === appOrigin;
  return headers.get("sec-fetch-site") === "same-origin";
}

/** Error envelope for a failed service result, including Retry-After for 429. */
export function jsonFailure(
  failure: { code: ApiErrorCode; message: string; fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number },
  requestId: string,
): Response {
  return jsonError(failure.code, failure.message, requestId, {
    fieldErrors: failure.fieldErrors,
    headers: failure.retryAfterSeconds ? { "retry-after": String(failure.retryAfterSeconds) } : undefined,
  });
}

/** Reads a JSON object body; malformed JSON and non-objects are reported separately. */
export async function readJsonBody(request: Request, maxBytes = 64 * 1024): Promise<{ ok: true; value: unknown } | { ok: false; code: "MALFORMED_JSON"; message: string }> {
  const text = await request.text();
  if (text.length > maxBytes) return { ok: false, code: "MALFORMED_JSON", message: "Request body is too large." };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, code: "MALFORMED_JSON", message: "Request body must be valid JSON." };
  }
}

/** A request body schema (lets apps validate without depending on zod directly). */
export type BodySchema<T = unknown> = z.ZodType<T>;

/** Zod issues → `field_errors` keyed by dotted path (`stores.0.role`). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "request";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
