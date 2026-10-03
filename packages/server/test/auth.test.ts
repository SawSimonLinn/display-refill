import type { Me } from "@display-refill/domain";
import { describe, expect, it } from "vitest";
import {
  bearerToken,
  createRateLimiter,
  fromDbError,
  isSameOriginRequest,
  parseIdempotencyKey,
  requestHash,
  resolveAdminOrganization,
} from "../src";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";

const me = (orgs: Array<[string, "admin" | "member"]>): Me => ({
  user_id: "00000000-0000-4000-8000-000000000001",
  email: "x@example.com",
  display_name: "",
  organizations: orgs.map(([id, role]) => ({ organization_id: id, name: id, role })),
  stores: [],
  capabilities: { dashboard: orgs.some(([, r]) => r === "admin"), admin_organization_ids: orgs.filter(([, r]) => r === "admin").map(([id]) => id) },
});

describe("isSameOriginRequest", () => {
  const app = "http://localhost:3000";
  it("accepts only the exact configured origin", () => {
    expect(isSameOriginRequest(new Headers({ origin: app }), app)).toBe(true);
    for (const origin of ["https://localhost:3000", "http://localhost:3001", "http://evil.example", "null", ""]) {
      expect(isSameOriginRequest(new Headers({ origin }), app), origin).toBe(false);
    }
  });
  it("without Origin, requires Sec-Fetch-Site: same-origin", () => {
    expect(isSameOriginRequest(new Headers(), app)).toBe(false);
    expect(isSameOriginRequest(new Headers({ "sec-fetch-site": "cross-site" }), app)).toBe(false);
    expect(isSameOriginRequest(new Headers({ "sec-fetch-site": "same-origin" }), app)).toBe(true);
    // An explicit foreign Origin wins over a forged fetch-metadata header.
    expect(isSameOriginRequest(new Headers({ origin: "http://evil.example", "sec-fetch-site": "same-origin" }), app)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("distinguishes absent, malformed and present", () => {
    expect(bearerToken(new Headers())).toBeUndefined();
    expect(bearerToken(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerToken(new Headers({ authorization: "Bearer a b" }))).toBeNull();
    expect(bearerToken(new Headers({ authorization: "Bearer a.b.c" }))).toBe("a.b.c");
  });
});

describe("resolveAdminOrganization", () => {
  it("uses the single administered organization by default", () => {
    expect(resolveAdminOrganization(me([[ORG_A, "admin"]]), undefined)).toEqual({ ok: true, value: ORG_A });
  });
  it("refuses members (403), unknown organizations (404) and ambiguity (422)", () => {
    expect(resolveAdminOrganization(me([[ORG_A, "member"]]), undefined)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(resolveAdminOrganization(me([[ORG_A, "member"]]), ORG_A)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(resolveAdminOrganization(me([[ORG_A, "admin"]]), ORG_B)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(resolveAdminOrganization(me([[ORG_A, "admin"], [ORG_B, "admin"]]), undefined)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(resolveAdminOrganization(me([[ORG_A, "admin"], [ORG_B, "admin"]]), ORG_B)).toEqual({ ok: true, value: ORG_B });
  });
});

describe("fromDbError", () => {
  it("maps trusted-function codes and hides unknown details", () => {
    expect(fromDbError({ message: "LAST_ADMIN", code: "P0001" })).toMatchObject({ code: "CONFLICT", message: expect.stringContaining("admin") });
    expect(fromDbError({ message: "FORBIDDEN", code: "P0001" })).toMatchObject({ code: "FORBIDDEN" });
    expect(fromDbError({ message: "VALIDATION_FAILED", code: "P0001", details: "duplicate store_id" })).toMatchObject({
      code: "VALIDATION_FAILED", fieldErrors: { request: ["duplicate store_id"] },
    });
    const unknown = fromDbError({ message: 'relation "secret_table" does not exist', code: "42P01" });
    expect(unknown).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(unknown)).not.toContain("secret_table");
    expect(fromDbError({ message: "TypeError: fetch failed" })).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});

describe("idempotency keys", () => {
  it("requires a well-formed header", () => {
    expect(parseIdempotencyKey(new Headers())).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(parseIdempotencyKey(new Headers({ "idempotency-key": "short" }))).toMatchObject({ ok: false });
    expect(parseIdempotencyKey(new Headers({ "idempotency-key": "has space in it" }))).toMatchObject({ ok: false });
    expect(parseIdempotencyKey(new Headers({ "idempotency-key": "0b0e7a9c-3f0e-4c7a" }))).toEqual({ ok: true, value: "0b0e7a9c-3f0e-4c7a" });
  });
  it("hashes bodies independent of key order but sensitive to values and route", () => {
    expect(requestHash("r", { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(requestHash("r", { b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(requestHash("r", { a: 1 })).not.toBe(requestHash("r", { a: 2 }));
    expect(requestHash("r1", { a: 1 })).not.toBe(requestHash("r2", { a: 1 }));
  });
});

describe("createRateLimiter", () => {
  it("allows `limit` hits per window and reports the wait", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.hit("k", 0)).toEqual({ allowed: true });
    expect(limiter.hit("k", 1)).toEqual({ allowed: true });
    expect(limiter.hit("k", 30_000)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(limiter.hit("other", 30_000)).toEqual({ allowed: true });
    expect(limiter.hit("k", 60_000)).toEqual({ allowed: true });
  });
  it("stays bounded in memory", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    for (let i = 0; i < 10; i++) limiter.hit(`k${i}`, 0);
    // The most recent key is still tracked.
    expect(limiter.hit("k9", 1)).toMatchObject({ allowed: false });
  });
});
