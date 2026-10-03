import "server-only";
import { type AdminServerConfig, isSameOriginRequest, type Logger, resolveRequestId } from "@display-refill/server";
import { NextResponse } from "next/server";
import { getAdminConfig, getLogger } from "./config";

/** 303 to an in-app path on APP_ORIGIN (never derived from the Host header). */
export function seeOther(config: AdminServerConfig, path: string, headers?: HeadersInit): NextResponse {
  const response = NextResponse.redirect(new URL(path, config.appOrigin), 303);
  response.headers.set("cache-control", "no-store");
  for (const [key, value] of new Headers(headers)) response.headers.set(key, value);
  return response;
}

export interface FormContext {
  config: AdminServerConfig;
  logger: Logger;
  requestId: string;
  form: FormData;
}

/**
 * Common checks for the auth form handlers: valid configuration, same-origin
 * POST (login CSRF and forced sign-out are both blocked), and a form body.
 */
export async function readForm(request: Request, errorPath: string): Promise<{ ok: true; ctx: FormContext } | { ok: false; response: Response }> {
  const requestId = resolveRequestId(request.headers);
  const result = getAdminConfig();
  if (!result.ok) {
    return { ok: false, response: new Response("Server configuration is invalid. See the server log.", { status: 503, headers: { "cache-control": "no-store" } }) };
  }
  const config = result.config;
  const logger = getLogger();
  if (!isSameOriginRequest(request.headers, config.appOrigin)) {
    logger.warn("auth form: cross-origin post rejected", { request_id: requestId, path: new URL(request.url).pathname });
    return { ok: false, response: seeOther(config, withQuery(errorPath, { error: "request" })) };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: seeOther(config, withQuery(errorPath, { error: "request" })) };
  }
  return { ok: true, ctx: { config, logger, requestId, form } };
}

export const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
