import { z } from "zod";
import { Rfc3339Utc, Uuid } from "./primitives";

export const API_VERSION = "v1";
export const API_BASE_PATH = "/api/v1";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Stable machine-readable error codes. HTTP status mapping follows
 * context/api-contracts.md; domain-specific codes are added with the feature
 * that first returns them.
 */
export const ApiErrorCode = z.enum([
  "MALFORMED_JSON", // 400
  "UNAUTHENTICATED", // 401
  "FORBIDDEN", // 403
  "NOT_FOUND", // 404
  "METHOD_NOT_ALLOWED", // 405
  "CONFLICT", // 409
  "POG_CHANGED", // 409
  "VALIDATION_FAILED", // 422
  "POG_NOT_ASSIGNED", // 422
  "UNRESOLVED_COUNTS", // 422
  "RATE_LIMITED", // 429
  "INTERNAL_ERROR", // 500
  "NOT_IMPLEMENTED", // 501
  "DEPENDENCY_UNAVAILABLE", // 503
  "CONFIGURATION_INVALID", // 503
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  MALFORMED_JSON: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  POG_CHANGED: 409,
  VALIDATION_FAILED: 422,
  POG_NOT_ASSIGNED: 422,
  UNRESOLVED_COUNTS: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  DEPENDENCY_UNAVAILABLE: 503,
  CONFIGURATION_INVALID: 503,
};

export const ApiError = z.strictObject({
  code: ApiErrorCode,
  message: z.string().min(1),
  field_errors: z.record(z.string(), z.array(z.string())).default({}),
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorEnvelope = z.strictObject({
  error: ApiError,
  request_id: Uuid,
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export function dataEnvelope<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, request_id: Uuid });
}

/** Health reports what is wired, and says plainly what is not implemented. */
export const HealthStatus = z.strictObject({
  status: z.literal("ok"),
  service: z.literal("admin-api"),
  api_version: z.literal(API_VERSION),
  checked_at: Rfc3339Utc,
  checks: z.strictObject({
    configuration: z.literal("ok"),
    database: z.literal("not_checked"),
    authentication: z.literal("not_implemented"),
    job_queue: z.literal("not_implemented"),
  }),
});
export type HealthStatus = z.infer<typeof HealthStatus>;
export const HealthEnvelope = dataEnvelope(HealthStatus);
