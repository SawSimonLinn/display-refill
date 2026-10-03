"use client";

export interface StoreOption {
  store_id: string;
  name: string;
  store_number: string;
}

export type Assignment = { store_id: string; role: "employee" | "manager" };

export type CallResult = { ok: true } | { ok: false; message: string };

/**
 * Same-origin call to /api/v1 with the session cookie. The browser adds the
 * Origin header the API checks for CSRF. The idempotency key belongs to one
 * user action and is reused if that action is retried.
 */
export async function callMembersApi(path: string, method: "POST" | "PATCH", body: unknown, idempotencyKey: string): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/members${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
  if (response.ok) return { ok: true };
  let payload: { error?: { code?: string; message?: string; field_errors?: Record<string, string[]> } } = {};
  try {
    payload = await response.json();
  } catch {
    // non-JSON error; fall through to the generic message
  }
  const code = payload.error?.code;
  if (response.status === 401) return { ok: false, message: "Your session ended. Reload the page and sign in again." };
  if (code === "CONFLICT") return { ok: false, message: payload.error?.message ?? "This member changed. Reload and try again." };
  const fields = Object.entries(payload.error?.field_errors ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`);
  return { ok: false, message: [payload.error?.message ?? "The change was not saved.", ...fields].join(" ") };
}
