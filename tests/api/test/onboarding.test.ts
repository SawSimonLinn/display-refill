import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiUser, createHarness, type Harness, waitForMail } from "../src/harness";

// Feature 16 unit 2: sign-up → email code → access code → create/join store → display types.
let h: Harness;
let org: string;
let admin: ApiUser;
let product: string;
const STATELESS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

beforeAll(async () => {
  h = await createHarness();
  org = randomUUID();
  product = randomUUID();
  await h.db.query("insert into public.organizations(id,name) values($1,'Onboarding HTTP')", [org]);
  await h.db.query("insert into public.products(id,organization_id,name,short_name,category,container_type) values($1,$2,'Onboard cup','Cup','Fruit','Cup')", [product, org]);
  admin = await h.user("onboard-http-admin", { org: { id: org, role: "admin" } });
});
afterAll(() => h?.close());

/** What the iOS app does: public sign-up, then the 6-digit code from the email. */
async function signUp(label: string) {
  const email = `${label}-${h.run}-${randomBytes(2).toString("hex")}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const client = createClient(h.env.apiUrl, h.env.publishableKey, STATELESS);
  const created = await client.auth.signUp({ email, password, options: { data: { display_name: label } } });
  expect(created.error).toBeNull();
  expect(created.data.session).toBeNull();
  const mail = await waitForMail(email);
  expect(mail.subject).toBe("Your Display Refill code");
  expect(mail.links).toEqual([]);
  const code = /\b(\d{6})\b/.exec(mail.html)?.[1];
  expect(code).toBeDefined();
  const verified = await client.auth.verifyOtp({ email, token: code!, type: "email" });
  expect(verified.error).toBeNull();
  return { email, token: verified.data.session!.access_token };
}

const join = (token: string, access_code: string) => h.api("/api/v1/onboarding/join", { method: "POST", token, body: { access_code } });
const store = (token: string, body: Record<string, string>) => h.api("/api/v1/onboarding/store", { method: "POST", token, body });

describe("self-service onboarding", () => {
  let code: string;
  let storeId: string;
  let manager: { token: string };
  let employee: { token: string };

  it("admins create and rotate the access code; others cannot see it", async () => {
    expect((await h.api("/api/v1/access-code", { token: admin.token })).json.data.code).toBeNull();
    const member = await h.user("onboard-http-member", { org: { id: org, role: "member" } });
    expect((await h.api("/api/v1/access-code", { token: member.token })).status).toBe(403);
    expect((await h.api("/api/v1/access-code", { method: "POST", token: member.token, body: { action: "rotate" } })).status).toBe(403);
    expect((await h.api("/api/v1/access-code", { method: "POST", token: admin.token, body: { action: "nope" } })).status).toBe(422);
    const rotated = await h.api("/api/v1/access-code", { method: "POST", token: admin.token, body: { action: "rotate" } });
    expect(rotated.status).toBe(200);
    code = rotated.json.data.code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("a new account signs up with an email code and has no access until it enters the code", async () => {
    manager = await signUp("onboard-first");
    expect((await h.api("/api/v1/me", { token: manager.token })).status).toBe(403);
    expect((await h.api("/api/v1/onboarding", { token: manager.token })).json.data).toEqual({ state: "access_code", organization: null, stores: [] });
    expect((await store(manager.token, { store_number: "77" })).status).toBe(403);

    const wrong = await join(manager.token, "WRONG-CODE");
    expect([wrong.status, wrong.json.error.code, wrong.json.error.field_errors]).toEqual([422, "VALIDATION_FAILED", { access_code: ["That access code is not valid."] }]);
    const joined = await join(manager.token, code.toLowerCase());
    expect(joined.status).toBe(200);
    expect(joined.json.data.state).toBe("store");
    const me = await h.api("/api/v1/me", { token: manager.token });
    expect([me.status, me.json.data.organizations[0].role, me.json.data.stores]).toEqual([200, "member", []]);
  });

  it("the first account creates the store as manager; a coworker joins it by number", async () => {
    const missing = await store(manager.token, { store_number: "FM-615" });
    expect([missing.status, Object.keys(missing.json.error.field_errors)]).toEqual([422, ["name"]]);
    const created = await store(manager.token, { store_number: "FM-615", name: "University Place", timezone: "America/Los_Angeles" });
    expect(created.status).toBe(200);
    expect(created.json.data).toMatchObject({ created: true, role: "manager", store: { name: "University Place", timezone: "America/Los_Angeles" } });
    storeId = created.json.data.store.store_id;
    const me = await h.api("/api/v1/me", { token: manager.token });
    expect([me.json.data.stores[0].role, me.json.data.capabilities.dashboard]).toEqual(["manager", true]);

    employee = await signUp("onboard-coworker");
    expect((await join(employee.token, code)).status).toBe(200);
    const joined = await store(employee.token, { store_number: "fm-615" });
    expect(joined.json.data).toMatchObject({ created: false, role: "employee", store: { store_id: storeId } });
    expect((await h.api("/api/v1/onboarding", { token: employee.token })).json.data.state).toBe("complete");
  });

  it("admins manage types; managers pick their store's types; Stock Check follows", async () => {
    const types = await h.api(`/api/v1/display-types`, { token: employee.token });
    expect(types.status).toBe(200);
    expect(types.json.data.types.map((t: { code: string }) => t.code)).toEqual(["fruit_mobile", "salad_mobile", "fruit_case", "veggie_case"]);
    const newType = { action: "save_type", code: "cold_case", name: "Cold Case", family: "Salads", sort_order: 50, active: true };
    expect((await h.api("/api/v1/display-types", { method: "POST", token: manager.token, body: newType })).status).toBe(403);
    const saved = await h.api("/api/v1/display-types", { method: "POST", token: admin.token, body: newType });
    expect(saved.status).toBe(200);
    const cold = saved.json.data.types.find((t: { code: string }) => t.code === "cold_case");
    const item = { action: "save_item", display_type_id: cold.id, product_id: product, par: 6, category: "Cups", product_type: "Cup", sort_order: 0, active: true };
    expect((await h.api("/api/v1/display-types", { method: "POST", token: admin.token, body: item })).status).toBe(200);
    const again = await h.api("/api/v1/display-types", { method: "POST", token: admin.token, body: item });
    expect([again.status, again.json.error.message]).toEqual([409, "This product is already in this display case type."]);

    const fruit = types.json.data.types.find((t: { code: string }) => t.code === "fruit_mobile");
    const put = (token: string, ids: string[]) => h.api(`/api/v1/stores/${storeId}/display-types`, { method: "PUT", token, body: { display_type_ids: ids } });
    expect((await put(employee.token, [cold.id])).status).toBe(403);
    expect((await put(manager.token, [])).status).toBe(422);
    const chosen = await put(manager.token, [fruit.id, cold.id]);
    expect(chosen.status).toBe(200);
    expect(chosen.json.data.sections.filter((s: { selected: boolean }) => s.selected).map((s: { code: string }) => s.code)).toEqual(["fruit_mobile", "cold_case"]);

    const day = await h.api(`/api/v1/production/${storeId}?view=day`, { token: employee.token });
    expect(day.json.data.sections.map((s: { section: string; name: string }) => [s.section, s.name])).toEqual([["fruit_mobile", "M1 Bunker (Fruit)"], ["cold_case", "Cold Case"]]);
    const start = await h.api(`/api/v1/production/${storeId}`, { method: "POST", token: employee.token, body: { action: "start", section: "cold_case" }, headers: { "idempotency-key": randomUUID() } });
    expect(start.status).toBe(200);
    expect(start.json.data.items.map((i: { product_name: string }) => i.product_name)).toEqual(["Onboard cup"]);
    const unselected = await h.api(`/api/v1/production/${storeId}`, { method: "POST", token: employee.token, body: { action: "start", section: "veggie_case" }, headers: { "idempotency-key": randomUUID() } });
    expect(unselected.status).toBe(422);
  });

  it("managers change store name and timezone; employees cannot", async () => {
    const revision = (await h.db.query("select revision from public.stores where id=$1", [storeId])).rows[0].revision;
    const patch = (token: string, body: Record<string, unknown>) => h.api(`/api/v1/stores/${storeId}/settings`, { method: "PATCH", token, body });
    expect((await patch(employee.token, { expected_revision: revision, name: "Mine", timezone: "UTC" })).status).toBe(403);
    expect((await patch(manager.token, { expected_revision: revision, name: "Mine", timezone: "Nowhere/Zone" })).json.error.field_errors).toHaveProperty("timezone");
    const ok = await patch(manager.token, { expected_revision: revision, name: "University Place 615", timezone: "America/Chicago" });
    expect([ok.status, ok.json.data.name, ok.json.data.timezone, ok.json.data.store_number]).toEqual([200, "University Place 615", "America/Chicago", "FM-615"]);
  });

  it("guessing codes is rate limited per account", async () => {
    const guesser = await signUp("onboard-guesser");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await join(guesser.token, `GUESS-${i}000`)).status);
    expect(statuses.slice(0, 10).every((s) => s === 422)).toBe(true);
    const limited = await join(guesser.token, code);
    expect([statuses[10], limited.status, limited.headers.get("retry-after")]).toEqual([429, 429, expect.stringMatching(/^\d+$/)]);
  });
});
