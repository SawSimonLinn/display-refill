import { describe, expect, it } from "vitest";
import { InviteMemberRequest, NewPassword, safeNextPath, UpdateMemberRequest } from "../src";

const STORE = "20000000-0000-4000-8000-0000000000a1";

describe("safeNextPath", () => {
  it("keeps known in-app paths", () => {
    for (const ok of ["/", "/members", "/stores/abc-123", "/account/password", "/scans?status=confirmed"]) {
      expect(safeNextPath(ok)).toBe(ok);
    }
  });

  it("rejects absolute, protocol-relative and disguised external destinations", () => {
    const hostile = [
      "https://evil.example/",
      "http:/evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/%2F%2Fevil.example",
      "/members/../../evil",
      "/./members",
      "javascript:alert(1)",
      " /members",
      "/members\n",
      "/members#frag",
      "members",
      "/unknown-page",
      "/sign-in", // not a post-auth destination; avoids redirect loops
      "/auth/confirm",
      "/" + "a".repeat(600),
    ];
    for (const bad of hostile) expect(safeNextPath(bad), JSON.stringify(bad)).toBe("/");
  });

  it("uses the supplied fallback for missing values", () => {
    expect(safeNextPath(null, "/account/password")).toBe("/account/password");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

describe("member requests", () => {
  it("normalizes email and rejects client-supplied authority fields", () => {
    const parsed = InviteMemberRequest.parse({ email: " New.User@Example.COM ", org_role: "member", stores: [{ store_id: STORE, role: "employee" }] });
    expect(parsed.email).toBe("new.user@example.com");
    // Strict objects: no actor_id, user_id or role smuggling.
    expect(InviteMemberRequest.safeParse({ email: "a@example.com", org_role: "member", stores: [], actor_id: STORE }).success).toBe(false);
    expect(InviteMemberRequest.safeParse({ email: "a@example.com", org_role: "owner", stores: [] }).success).toBe(false);
    expect(InviteMemberRequest.safeParse({ email: "a@example.com", org_role: "member", stores: [{ store_id: STORE, role: "admin" }] }).success).toBe(false);
  });

  it("rejects duplicate stores and empty updates", () => {
    const dup = [{ store_id: STORE, role: "employee" }, { store_id: STORE, role: "manager" }];
    expect(InviteMemberRequest.safeParse({ email: "a@example.com", org_role: "member", stores: dup }).success).toBe(false);
    expect(UpdateMemberRequest.safeParse({ expected_revision: 1 }).success).toBe(false);
    expect(UpdateMemberRequest.safeParse({ expected_revision: 0, active: false }).success).toBe(false);
    expect(UpdateMemberRequest.safeParse({ expected_revision: 3, stores: [] }).success).toBe(true);
  });

  it("enforces the password length policy", () => {
    expect(NewPassword.safeParse("short-pass").success).toBe(false);
    expect(NewPassword.safeParse("long-enough-pass").success).toBe(true);
    expect(NewPassword.safeParse("x".repeat(73)).success).toBe(false);
  });
});
