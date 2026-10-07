import type { Me } from "@display-refill/domain";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, fromDbError, resolveMemberOrganization } from "../src";

const ID = "20000000-0000-4000-8000-0000000000a1";

describe("list cursors", () => {
  it("round-trips the Postgres timestamp and id", () => {
    const position = { created_at: "2026-10-03T18:23:35.955225+00:00", id: ID };
    const cursor = encodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(position);
  });

  it("rejects anything it did not issue, including filter injection attempts", () => {
    const forged = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const raw of [
      "",
      "not base64!",
      forged({ t: "2026-10-03T18:23:35Z", i: ID }),
      forged(["2026-10-03T18:23:35Z", "not-a-uuid"]),
      forged(['2026-10-03T18:23:35Z",id.gt.0)', ID]),
      forged(["yesterday", ID]),
      "a".repeat(201),
    ]) {
      expect(decodeCursor(raw), raw).toBeNull();
    }
  });
});

describe("fromDbError field hints", () => {
  it("puts a validation detail under the field named in HINT", () => {
    expect(fromDbError({ message: "VALIDATION_FAILED", details: "is already used", hint: "store_number" })).toMatchObject({
      code: "VALIDATION_FAILED", fieldErrors: { store_number: ["is already used"] },
    });
  });

  it("falls back to `request` for a missing or unexpected hint", () => {
    for (const hint of [null, undefined, "Store Number", "a.b", "x".repeat(80)]) {
      expect(fromDbError({ message: "VALIDATION_FAILED", details: "bad", hint }).fieldErrors, String(hint)).toEqual({ request: ["bad"] });
    }
  });

  it("passes through known user-facing conflict details", () => {
    expect(fromDbError({ message: "CONFLICT", details: "This check belongs to an earlier day. Start a new check." })).toEqual({
      ok: false, code: "CONFLICT", message: "This check belongs to an earlier day. Start a new check.",
    });
  });

  it("does not expose details for non-validation errors", () => {
    expect(fromDbError({ message: "CONFLICT", details: "expected revision 1, current 2", hint: "x" })).toEqual({
      ok: false, code: "CONFLICT", message: "This record changed or already exists. Reload and try again.",
    });
  });
});

describe("resolveMemberOrganization", () => {
  const me = (orgs: string[]): Me => ({
    user_id: ID, email: null, display_name: "", stores: [],
    organizations: orgs.map((id) => ({ organization_id: id, name: id, role: "member" as const })),
    capabilities: { dashboard: false, admin_organization_ids: [] },
  });
  const A = "10000000-0000-4000-8000-00000000000a";
  const B = "10000000-0000-4000-8000-00000000000b";

  it("uses the only organization, requires a choice among several, and hides others", () => {
    expect(resolveMemberOrganization(me([A]), undefined)).toEqual({ ok: true, value: A });
    expect(resolveMemberOrganization(me([A, B]), undefined)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(resolveMemberOrganization(me([A, B]), B)).toEqual({ ok: true, value: B });
    expect(resolveMemberOrganization(me([A]), B)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
