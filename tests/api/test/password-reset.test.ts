import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiUser, CookieJar, createHarness, type Harness, mailsTo, SEED, waitForMail } from "../src/harness";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h?.close());

const employee = () => h.user("reset", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] });

/** Follows a recovery email link through confirm → verify; returns the session jar. */
async function openRecoveryLink(link: string) {
  const url = new URL(link);
  expect(`${url.origin}${url.pathname}`).toBe(`${h.base}/auth/confirm`);
  expect(url.searchParams.get("type")).toBe("recovery");
  const confirm = await h.page(`${url.pathname}${url.search}`);
  expect(confirm.status).toBe(200);
  const jar = new CookieJar();
  const verified = await h.form("/auth/verify", { token_hash: url.searchParams.get("token_hash")!, type: "recovery" }, { jar });
  return { jar, verified, tokenHash: url.searchParams.get("token_hash")! };
}

describe("web password reset", () => {
  it("emails an allowlisted link; the new password works, the old one does not, and the link is single-use", async () => {
    const u: ApiUser = await employee();
    const sent = await h.form("/auth/forgot-password", { email: u.email });
    expect(sent.location).toBe(`${h.base}/forgot-password?sent=1`);
    const mail = await waitForMail(u.email);
    expect(mail.subject).toBe("Reset your Display Refill password");

    const { jar, verified, tokenHash } = await openRecoveryLink(mail.links[0]!);
    expect(verified.location).toBe(`${h.base}/account/password?from=recovery`);

    const weak = await h.form("/auth/set-password", { password: "short", confirm_password: "short", from: "recovery" }, { jar });
    expect(weak.location).toBe(`${h.base}/account/password?error=weak&from=recovery`);
    const mismatch = await h.form("/auth/set-password", { password: "a-long-new-password-1", confirm_password: "a-long-new-password-2" }, { jar });
    expect(mismatch.location).toBe(`${h.base}/account/password?error=mismatch`);

    const password = `New-${randomUUID()}`;
    const set = await h.form("/auth/set-password", { password, confirm_password: password }, { jar });
    expect(set.location).toBe(`${h.base}/account/password?updated=1`);

    await expect(h.signIn(u.email, u.password)).rejects.toThrow();
    await expect(h.signIn(u.email, password)).resolves.toMatchObject({ access_token: expect.any(String) });

    // Reusing the same link fails.
    const again = await h.form("/auth/verify", { token_hash: tokenHash, type: "recovery" }, { jar: new CookieJar() });
    expect(again.location).toBe(`${h.base}/auth/confirm?error=expired`);
  });

  it("answers the same for unknown emails and sends nothing", async () => {
    const email = `unknown-${h.run}@example.com`;
    const res = await h.form("/auth/forgot-password", { email });
    expect(res.location).toBe(`${h.base}/forgot-password?sent=1`);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mailsTo(email)).toEqual([]);
  });

  it("rejects cross-origin reset requests", async () => {
    const u = await employee();
    const res = await h.form("/auth/forgot-password", { email: u.email }, { origin: "http://evil.example" });
    expect(res.location).toBe(`${h.base}/forgot-password?error=request`);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mailsTo(u.email)).toEqual([]);
  });

  it("set-password requires a session", async () => {
    const res = await h.form("/auth/set-password", { password: "a-long-new-password", confirm_password: "a-long-new-password" });
    expect(res.location).toBe(`${h.base}/sign-in?error=expired&next=/account/password`);
    expect((await h.page("/account/password")).location).toBe("/sign-in?next=%2Faccount%2Fpassword");
  });
});

describe("redirect allowlisting", () => {
  it("the confirm page and verify handler only accept invite/recovery links", async () => {
    for (const type of ["signup", "magiclink", "email_change", ""]) {
      const page = await h.page(`/auth/confirm?token_hash=abcdefabcdefabcdef1234&type=${type}`);
      expect(page.html, type).toContain("Link not valid");
      const verify = await h.form("/auth/verify", { token_hash: "abcdefabcdefabcdef1234", type });
      expect(verify.location, type).toBe(`${h.base}/auth/confirm?error=invalid`);
    }
  });

  it("Supabase Auth ignores a non-allowlisted redirect_to sent directly to it", async () => {
    const u = await employee();
    const res = await fetch(`${h.env.apiUrl}/auth/v1/recover?redirect_to=${encodeURIComponent("https://evil.example/steal")}`, {
      method: "POST", headers: { apikey: h.env.publishableKey, "content-type": "application/json" }, body: JSON.stringify({ email: u.email }),
    });
    expect(res.status).toBe(200);
    const mail = await waitForMail(u.email);
    expect(mail.html).not.toContain("evil.example");
    // Falls back to the configured site URL, on the app's own host.
    expect(new URL(mail.links[0]!).hostname).toBe("localhost");
  });

  it("the iOS reset endpoint cannot be given a redirect and never reveals account existence", async () => {
    const u = await employee();
    const withRedirect = await h.api("/api/v1/auth/password-reset", { method: "POST", body: { email: u.email, redirect_to: "https://evil.example" } });
    expect(withRedirect.status).toBe(422);
    const known = await h.api("/api/v1/auth/password-reset", { method: "POST", body: { email: u.email } });
    const unknown = await h.api("/api/v1/auth/password-reset", { method: "POST", body: { email: `ghost-${h.run}@example.com` } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.json.data).toEqual(known.json.data);
    const mail = await waitForMail(u.email);
    expect(new URL(mail.links[0]!).origin + new URL(mail.links[0]!).pathname).toBe(`${h.base}/auth/confirm`);
  });
});

describe("rate limits", () => {
  it("limits reset requests per email and returns Retry-After", async () => {
    const email = `limited-${h.run}@example.com`;
    for (let i = 0; i < 3; i++) expect((await h.api("/api/v1/auth/password-reset", { method: "POST", body: { email } })).status).toBe(202);
    const limited = await h.api("/api/v1/auth/password-reset", { method: "POST", body: { email } });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const web = await h.form("/auth/forgot-password", { email });
    expect(web.location).toBe(`${h.base}/forgot-password?error=rate_limited`);
  });
});
