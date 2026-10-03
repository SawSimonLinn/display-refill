import "server-only";
import { ListQuery, Uuid } from "@display-refill/domain";
import {
  type BodySchema,
  createCallerClient,
  createServiceClient,
  type DbClient,
  fieldErrorsOf,
  jsonData,
  jsonError,
  jsonFailure,
  parseIdempotencyKey,
  readJsonBody,
  resolveRequestId,
  type ServiceResult,
  withIdempotency,
} from "@display-refill/server";
import { type ApiContext, authenticateApi } from "./api-auth";
import { replay } from "./api-respond";

type Outcome<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Caller-scoped client for reads: RLS applies to the verified user. */
export const callerClient = (ctx: ApiContext): DbClient => createCallerClient(ctx.config, ctx.accessToken);

/** Route parameter that must be a UUID; anything else is an unknown resource (404). */
export function uuidParam(value: string, what: string, requestId: string): Outcome<string> {
  return Uuid.safeParse(value).success ? { ok: true, value } : { ok: false, response: jsonError("NOT_FOUND", `${what} not found.`, requestId) };
}

export const forbidden = (message: string, requestId: string): { ok: false; response: Response } => ({
  ok: false,
  response: jsonError("FORBIDDEN", message, requestId),
});

/**
 * GET handler for a list or detail read: authenticate, parse
 * `?status=&cursor=&limit=&organization_id=`, run the read with the caller's
 * own (RLS-scoped) client and serialize.
 */
export async function handleRead<T>(request: Request, read: (ctx: ApiContext, query: ListQuery, requestId: string) => Promise<ServiceResult<T> | Outcome<T>>): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: false });
  if (!auth.ok) return auth.response;
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });
  const result = await read(auth.ctx, parsed.data, requestId);
  if (result.ok) return jsonData(result.value, requestId);
  return "response" in result ? result.response : jsonFailure(result, requestId);
}

/**
 * Shared shape of every catalog mutation: authenticate (with the CSRF check
 * for cookies), parse a strict JSON body, run the route's cheap authorization
 * pre-check from the caller's memberships, require Idempotency-Key, then
 * execute at most once per key. The database function re-checks the actor
 * against the stored resource regardless of the pre-check.
 */
export async function handleMutation<B, P, T>(
  request: Request,
  options: {
    schema: BodySchema<B>;
    routeScope: string;
    successStatus: 200 | 201;
    prepare: (ctx: ApiContext, body: B, requestId: string) => Outcome<P>;
    execute: (service: DbClient, ctx: ApiContext, body: B, prepared: P, requestId: string) => Promise<ServiceResult<T>>;
    resourceId: (value: T) => string;
    /** Resolved request context folded into the idempotency hash (e.g. the organization). */
    hashExtra?: (prepared: P) => Record<string, unknown>;
  },
): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.code, body.message, requestId);
  const parsed = options.schema.safeParse(body.value);
  if (!parsed.success) return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: fieldErrorsOf(parsed.error) });

  const prepared = options.prepare(ctx, parsed.data, requestId);
  if (!prepared.ok) return prepared.response;
  const key = parseIdempotencyKey(request.headers);
  if (!key.ok) return jsonFailure(key, requestId);

  const service = createServiceClient(ctx.config);
  const outcome = await withIdempotency(
    service,
    { actorId: ctx.user.id, routeScope: options.routeScope, key: key.value, body: { ...(parsed.data as object), ...options.hashExtra?.(prepared.value) } },
    async () => {
      const result = await options.execute(service, ctx, parsed.data, prepared.value, requestId);
      if (!result.ok) {
        const response = jsonFailure(result, requestId);
        return { status: response.status, body: await response.json() };
      }
      const resourceId = options.resourceId(result.value);
      ctx.logger.info("catalog: change applied", { request_id: requestId, route: options.routeScope, actor_id: ctx.user.id, resource_id: resourceId });
      return { status: options.successStatus, body: { data: result.value, request_id: requestId }, resourceId };
    },
  );
  if (!outcome.ok) return jsonFailure(outcome, requestId);
  return replay(outcome.value, requestId);
}

/**
 * POST actions that must not go through idempotency records because their
 * response carries a short-lived credential (a signed upload or download
 * URL) that may not be persisted. Authentication includes the CSRF check for
 * cookies; the body must be an empty JSON object or absent.
 */
export async function handleAction<T>(
  request: Request,
  options: {
    successStatus: 200 | 201;
    prepare: (ctx: ApiContext, requestId: string) => Outcome<null>;
    execute: (ctx: ApiContext, requestId: string) => Promise<ServiceResult<T>>;
  },
): Promise<Response> {
  const requestId = resolveRequestId(request.headers);
  const auth = await authenticateApi(request, requestId, { mutation: true });
  if (!auth.ok) return auth.response;
  const text = await request.text();
  if (text.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError("MALFORMED_JSON", "Request body must be valid JSON.", requestId);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) {
      return jsonError("VALIDATION_FAILED", "The request contains invalid values.", requestId, { fieldErrors: { request: ["must be empty"] } });
    }
  }
  const prepared = options.prepare(auth.ctx, requestId);
  if (!prepared.ok) return prepared.response;
  const result = await options.execute(auth.ctx, requestId);
  if (!result.ok) return jsonFailure(result, requestId);
  return jsonData(result.value, requestId, { status: options.successStatus });
}

/** Admin-only routes: callers who administer no organization are refused before any database call. */
export const requireSomeAdmin = (ctx: ApiContext, message: string, requestId: string): Outcome<null> =>
  ctx.me.capabilities.admin_organization_ids.length > 0 ? { ok: true, value: null } : forbidden(message, requestId);

/** Display routes: callers who manage no store and administer no organization are refused early. */
export const requireSomeManager = (ctx: ApiContext, requestId: string): Outcome<null> =>
  ctx.me.capabilities.dashboard ? { ok: true, value: null } : forbidden("Only store managers and organization admins manage displays.", requestId);
