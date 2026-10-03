import { API_ERROR_STATUS, type ApiErrorCode, REQUEST_ID_HEADER } from "@display-refill/domain";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reuses a well-formed client request ID, otherwise issues a new one. */
export function resolveRequestId(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER)?.trim();
  return supplied && UUID.test(supplied) ? supplied.toLowerCase() : crypto.randomUUID();
}

/** User-specific API responses must never enter shared caches. */
function baseHeaders(requestId: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

export function jsonData(data: unknown, requestId: string, init?: { status?: number; headers?: HeadersInit }): Response {
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
  return Response.json(
    { error: { code, message, field_errors: init?.fieldErrors ?? {} }, request_id: requestId },
    { status: API_ERROR_STATUS[code], headers: baseHeaders(requestId, init?.headers) },
  );
}
