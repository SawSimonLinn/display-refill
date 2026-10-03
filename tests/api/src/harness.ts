import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@display-refill/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { localSupabase } from "../../db/src/env";
import { SEED } from "../../db/src/seed-ids";

export { SEED };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** The admin server under test (started by scripts/run-api-tests.mjs). Loopback only. */
export function adminBaseUrl(): string {
  const base = process.env.ADMIN_BASE_URL;
  if (!base) throw new Error("ADMIN_BASE_URL is not set; run `npm run test:api`.");
  if (!LOCAL_HOSTS.has(new URL(base).hostname)) throw new Error("ADMIN_BASE_URL must be a loopback address.");
  return base.replace(/\/$/, "");
}

export function mailpitUrl(): string {
  const url = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) throw new Error("MAILPIT_URL must be a loopback address.");
  return url.replace(/\/$/, "");
}

const STATELESS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export interface ApiUser {
  id: string;
  email: string;
  password: string;
  /** Access token from a fresh password sign-in (as the iOS app would hold). */
  token: string;
  refreshToken: string;
}

type Spec = {
  org?: { id: string; role: "member" | "admin"; active?: boolean };
  stores?: Array<{ id: string; role: "employee" | "manager"; active?: boolean }>;
};

export async function createHarness() {
  const env = localSupabase();
  const base = adminBaseUrl();
  const run = randomUUID().slice(0, 8);
  const service: SupabaseClient<Database> = createClient<Database>(env.apiUrl, env.secretKey, STATELESS);
  const db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();

  async function signIn(email: string, password: string) {
    const client = createClient<Database>(env.apiUrl, env.publishableKey, STATELESS);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error ?? new Error("sign-in failed");
    return data.session;
  }

  async function user(label: string, spec: Spec = {}): Promise<ApiUser> {
    const email = `${label}-${run}-${randomBytes(2).toString("hex")}@example.com`;
    const password = randomBytes(24).toString("base64url");
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const id = created.data.user.id;
    if (spec.org) {
      const { error } = await service.from("organization_memberships").insert({
        organization_id: spec.org.id, user_id: id, role: spec.org.role, active: spec.org.active ?? true,
      });
      if (error) throw error;
    }
    for (const s of spec.stores ?? []) {
      const { error } = await service.from("store_memberships").insert({
        organization_id: spec.org!.id, store_id: s.id, user_id: id, role: s.role, active: s.active ?? true,
      });
      if (error) throw error;
    }
    const session = await signIn(email, password);
    return { id, email, password, token: session.access_token, refreshToken: session.refresh_token };
  }

  /** JSON request to the admin server. `token` sends a bearer; `jar` sends/collects cookies. */
  async function api(path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; jar?: CookieJar } = {}) {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (init.jar) init.jar.apply(headers);
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
      redirect: "manual",
    });
    init.jar?.collect(response);
    const text = await response.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, json, text };
  }

  /** HTML form POST, as a browser on APP_ORIGIN would send it. */
  async function form(path: string, fields: Record<string, string>, opts: { jar?: CookieJar; origin?: string | null } = {}) {
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
    if (opts.origin !== null) headers.set("origin", opts.origin ?? base);
    opts.jar?.apply(headers);
    const response = await fetch(`${base}${path}`, { method: "POST", headers, body: new URLSearchParams(fields), redirect: "manual" });
    opts.jar?.collect(response);
    await response.arrayBuffer();
    return { status: response.status, location: response.headers.get("location"), headers: response.headers };
  }

  /** GET a page with the jar's cookies, without following redirects. */
  async function page(path: string, jar?: CookieJar) {
    const headers = new Headers();
    jar?.apply(headers);
    const response = await fetch(`${base}${path}`, { headers, redirect: "manual" });
    jar?.collect(response);
    return { status: response.status, location: response.headers.get("location"), headers: response.headers, html: await response.text() };
  }

  /** Signs in through the web form; returns a jar holding the session cookies. */
  async function webSignIn(u: { email: string; password: string }, next?: string) {
    const jar = new CookieJar();
    const res = await form("/auth/sign-in", { email: u.email, password: u.password, ...(next ? { next } : {}) }, { jar });
    return { jar, res };
  }

  return {
    env, base, run, service, db, user, signIn, api, form, page, webSignIn,
    async close() {
      await db.end();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** Minimal cookie jar for one origin: enough for the session cookie flow. */
export class CookieJar {
  readonly cookies = new Map<string, string>();
  /** Raw Set-Cookie lines from the last response, for attribute checks. */
  lastSetCookie: string[] = [];

  apply(headers: Headers) {
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  }

  collect(response: Response) {
    this.lastSetCookie = response.headers.getSetCookie();
    for (const line of this.lastSetCookie) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const expired = attrs.some((a) => /^max-age=0$/i.test(a)) || attrs.some((a) => /^expires=/i.test(a) && Date.parse(a.slice(8)) < Date.now());
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  authCookieNames() {
    return [...this.cookies.keys()].filter((n) => n.startsWith("sb-") && n.includes("-auth-token"));
  }

  clone() {
    const copy = new CookieJar();
    for (const [k, v] of this.cookies) copy.cookies.set(k, v);
    return copy;
  }

  /** Decodes the @supabase/ssr session cookie (base64url, possibly chunked). */
  session(): { access_token: string; refresh_token: string; expires_at: number; [k: string]: unknown } {
    const names = this.authCookieNames().sort((a, b) => chunkIndex(a) - chunkIndex(b));
    if (!names.length) throw new Error("no session cookie");
    const raw = names.map((n) => this.cookies.get(n)!).join("");
    return JSON.parse(Buffer.from(decodeURIComponent(raw).replace(/^base64-/, ""), "base64url").toString("utf8"));
  }

  /** Replaces the session cookie with `session` (single, unchunked cookie). */
  setSession(session: object) {
    const names = this.authCookieNames();
    const baseName = names[0]!.replace(/\.\d+$/, "");
    for (const n of names) this.cookies.delete(n);
    this.cookies.set(baseName, `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`);
  }
}

const chunkIndex = (name: string) => Number(/\.(\d+)$/.exec(name)?.[1] ?? -1);

// ---------------------------------------------------------------------------
// Mailpit (local SMTP capture)
// ---------------------------------------------------------------------------

interface MailSummary {
  ID: string;
  Subject: string;
}

export async function mailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  const body = (await res.json()) as { messages: MailSummary[] };
  return body.messages ?? [];
}

/** Waits for the `count`-th email to `address` and returns its links (HTML-decoded). */
export async function waitForMail(address: string, count = 1, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await mailsTo(address);
    if (messages.length >= count) {
      // Search results are newest first.
      const message = (await (await fetch(`${mailpitUrl()}/api/v1/message/${messages[0]!.ID}`)).json()) as { HTML: string; Subject: string };
      const links = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
      return { subject: message.Subject, html: message.HTML, links };
    }
    if (Date.now() > deadline) throw new Error(`no email #${count} to ${address} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
