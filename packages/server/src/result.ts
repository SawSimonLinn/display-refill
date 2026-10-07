import type { ApiErrorCode } from "@display-refill/domain";

/** Outcome of a server service call; route handlers turn failures into the error envelope. */
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ApiErrorCode; message: string; fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number };

export const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });

export const fail = (
  code: ApiErrorCode,
  message: string,
  extra?: { fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number },
): { ok: false; code: ApiErrorCode; message: string; fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number } => ({
  ok: false,
  code,
  message,
  ...extra,
});

/** Error message codes raised by trusted functions and triggers (decision D26). */
const DB_CODES: Record<string, { code: ApiErrorCode; message: string }> = {
  IMAGE_UNAVAILABLE: { code: "DEPENDENCY_UNAVAILABLE", message: "Photo is unavailable under retention policy. Enter counts manually." },
  VISION_DISABLED: { code: "DEPENDENCY_UNAVAILABLE", message: "Image analysis is disabled. Use a manual check or manual takeover." },
  NOT_FOUND: { code: "NOT_FOUND", message: "Not found." },
  FORBIDDEN: { code: "FORBIDDEN", message: "You do not have permission to do that." },
  CONFLICT: { code: "CONFLICT", message: "This record changed or already exists. Reload and try again." },
  VALIDATION_FAILED: { code: "VALIDATION_FAILED", message: "The request contains invalid values." },
  LAST_ADMIN: { code: "CONFLICT", message: "An organization must keep at least one active admin." },
  IMMUTABLE: { code: "CONFLICT", message: "This record can no longer be changed." },
  POG_NOT_ASSIGNED: { code: "POG_NOT_ASSIGNED", message: "No published layout is assigned." },
  POG_CHANGED: { code: "POG_CHANGED", message: "The layout changed. Refresh and try again." },
};

/** Fixed, user-facing CONFLICT details raised by our functions; any other detail stays private. */
const PUBLIC_CONFLICT_DETAILS = new Set([
  "This check belongs to an earlier day. Start a new check.",
  "A newer stock check was published. Start a fresh count.",
  "Stock or preparation changed during this count. Start a fresh count including all ready containers.",
  "Someone recorded preparation during this count. Start a fresh count including all ready containers.",
  "Configure additional sections before starting today’s checks.",
]);

/** Request field names our functions put in HINT (snake_case identifiers only). */
const FIELD_HINT = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Maps a PostgREST/Postgres error from a trusted function to an API error.
 * VALIDATION_FAILED details become field errors keyed by the HINT field name
 * (or `request`). Unknown errors become DEPENDENCY_UNAVAILABLE (network) or
 * INTERNAL_ERROR.
 */
export function fromDbError(error: { message?: string; code?: string; details?: string | null; hint?: string | null }) {
  const known = error.message ? DB_CODES[error.message] : undefined;
  if (known) {
    // Validation details from our own functions are safe, fixed strings.
    const field = error.hint && FIELD_HINT.test(error.hint) ? error.hint : "request";
    const detail = error.message === "VALIDATION_FAILED" && error.details ? { fieldErrors: { [field]: [error.details] } } : undefined;
    if (error.message === "CONFLICT" && error.details && PUBLIC_CONFLICT_DETAILS.has(error.details)) return fail(known.code, error.details);
    return fail(known.code, known.message, detail);
  }
  if (!error.code || error.code.startsWith("PGRST0") || error.message?.includes("fetch failed")) {
    return fail("DEPENDENCY_UNAVAILABLE", "The database is unavailable. Try again shortly.");
  }
  return fail("INTERNAL_ERROR", "Unexpected database error.");
}
