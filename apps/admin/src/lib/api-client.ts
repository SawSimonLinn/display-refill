/**
 * Same-origin calls from the dashboard to /api/v1 with the httpOnly session
 * cookie. The browser adds the Origin header the API checks for CSRF.
 * Server responses are the only authority: the UI hides actions the caller
 * cannot take, but every request is authorized again by the API.
 */

export type ApiFailureKind = "network" | "session" | "forbidden" | "not_found" | "conflict" | "validation" | "rate_limited" | "server";

export interface ApiFailure {
  kind: ApiFailureKind;
  status: number;
  code: string;
  message: string;
  fieldErrors: Record<string, string[]>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

function kindOf(status: number): ApiFailureKind {
  if (status === 401) return "session";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status === 429) return "rate_limited";
  return "server";
}

const networkFailure = (): { ok: false; failure: ApiFailure } => ({
  ok: false,
  failure: { kind: "network", status: 0, code: "NETWORK", message: "Could not reach the server. Check your connection and try again.", fieldErrors: {} },
});

/**
 * JSON call to /api/v1. Mutations that the API makes idempotent pass an
 * `idempotencyKey`; GET reads and the credential-issuing POST actions
 * (upload-intent, image-access) do not.
 */
export async function apiRequest<T>(path: string, init: { method: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; idempotencyKey?: string }): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    response = await fetch(`/api/v1${path}`, {
      method: init.method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return networkFailure();
  }
  let payload: { data?: T; error?: { code?: string; message?: string; field_errors?: Record<string, string[]> } } = {};
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error body; the status still classifies it.
  }
  if (response.ok) return { ok: true, data: payload.data as T };
  return {
    ok: false,
    failure: {
      kind: kindOf(response.status),
      status: response.status,
      code: payload.error?.code ?? "UNKNOWN",
      message: payload.error?.message ?? "The change was not saved.",
      fieldErrors: payload.error?.field_errors ?? {},
    },
  };
}

/**
 * Uploads POG reference bytes to the authenticated exact-path API endpoint.
 * Cookie authentication includes the same-origin/CSRF check.
 */
export async function uploadReferenceImage(url: string, body: Blob): Promise<ApiResult<null>> {
  let response: Response;
  try {
    response = await fetch(url, { method: "PUT", headers: { "content-type": "image/jpeg", "x-upsert": "false" }, body, credentials: "same-origin", cache: "no-store" });
  } catch {
    return networkFailure();
  }
  if (response.ok) return { ok: true, data: null };
  return {
    ok: false,
    failure: {
      kind: response.status === 413 ? "validation" : kindOf(response.status),
      status: response.status,
      code: "UPLOAD_FAILED",
      message: response.status === 413 ? "The image is larger than 10 MB." : "The image upload failed. Try again.",
      fieldErrors: {},
    },
  };
}
