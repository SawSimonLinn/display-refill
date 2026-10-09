import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { createWorld, errorOf, rows, type World } from "../src/world";

let w: World;
let scanId: string;
let scanSlotId: string;

beforeAll(async () => {
  w = await createWorld();
  const created = await w.service.rpc("create_scan", { p_actor: w.users.employeeA1.id, p_display_id: SEED.displayA1, p_source: "manual" });
  if (created.error) throw created.error;
  scanId = created.data[0]!.scan_id;
  const slots = await rows<{ id: string }>(w.service.from("scan_slots").select("id").eq("scan_id", scanId));
  scanSlotId = slots[0]!.id;
});
afterAll(() => w?.close());

const DENIED = "42501"; // insufficient_privilege

describe("authenticated users cannot write directly", () => {
  it("cannot escalate their own role", async () => {
    const { employeeA1 } = w.users;
    expect((await errorOf(employeeA1.client.from("store_memberships").update({ role: "manager" }).eq("user_id", employeeA1.id)))?.code).toBe(DENIED);
    expect((await errorOf(employeeA1.client.from("organization_memberships").update({ role: "admin" }).eq("user_id", employeeA1.id)))?.code).toBe(DENIED);
    expect(
      (await errorOf(employeeA1.client.from("store_memberships").insert({
        organization_id: SEED.orgA, store_id: SEED.storeA2, user_id: employeeA1.id, role: "manager",
      })))?.code,
    ).toBe(DENIED);
    const memberships = await rows<{ role: string; store_id: string }>(
      w.service.from("store_memberships").select("role, store_id").eq("user_id", employeeA1.id),
    );
    expect(memberships).toEqual([{ role: "employee", store_id: SEED.storeA1 }]);
  });

  it("even org admins cannot write tables directly (writes go through the API)", async () => {
    const { adminA } = w.users;
    expect((await errorOf(adminA.client.from("stores").insert({ organization_id: SEED.orgA, name: "x", store_number: "X", timezone: "UTC" })))?.code).toBe(DENIED);
    expect((await errorOf(adminA.client.from("products").update({ name: "Renamed" }).eq("id", SEED.productCobb)))?.code).toBe(DENIED);
    expect((await errorOf(adminA.client.from("pog_slots").update({ target_quantity: 9 }).eq("id", SEED.slotA1)))?.code).toBe(DENIED);
    expect((await errorOf(adminA.client.from("displays").update({ active_pog_version_id: SEED.versionB1 }).eq("id", SEED.displayA1)))?.code).toBe(DENIED);
  });

  it("cannot write counts, refill totals, confirmations, audit, jobs or uploads", async () => {
    const c = w.users.employeeA1.client;
    expect((await errorOf(c.from("scan_slots").update({ accepted_quantity: 2, refill_quantity: 0 }).eq("id", scanSlotId)))?.code).toBe(DENIED);
    expect((await errorOf(c.from("scans").update({ status: "confirmed", total_refill: 0 }).eq("id", scanId)))?.code).toBe(DENIED);
    expect((await errorOf(c.from("scans").delete().eq("id", scanId)))?.code).toBe(DENIED);
    expect(
      (await errorOf(c.from("scan_confirmations").insert({
        organization_id: SEED.orgA, scan_id: scanId, scan_revision: 1, confirmed_by: w.users.employeeA1.id, total_refill: 0,
      })))?.code,
    ).toBe(DENIED);
    expect(
      (await errorOf(c.from("scan_corrections").insert({
        organization_id: SEED.orgA, scan_id: scanId, scan_slot_id: scanSlotId, actor_id: w.users.employeeA1.id,
        corrected_quantity: 1, scan_revision: 1,
      })))?.code,
    ).toBe(DENIED);
    expect(
      (await errorOf(c.from("audit_events").insert({
        organization_id: SEED.orgA, event_type: "scan.faked", resource_id: scanId,
      })))?.code,
    ).toBe(DENIED);
    expect((await errorOf(c.from("scan_jobs").insert({ organization_id: SEED.orgA, scan_id: scanId, generation: 0 })))?.code).toBe(DENIED);

    const slot = await rows(w.service.from("scan_slots").select("accepted_quantity, refill_quantity").eq("id", scanSlotId));
    expect(slot).toEqual([{ accepted_quantity: null, refill_quantity: null }]);
    const scan = await rows(w.service.from("scans").select("status").eq("id", scanId));
    expect(scan).toEqual([{ status: "needs_review" }]);
  });

  it("cannot call trusted functions, and cannot impersonate another actor through them", async () => {
    const c = w.users.employeeA1.client;
    const create = await c.rpc("create_scan", { p_actor: w.users.adminA.id, p_display_id: SEED.displayA1, p_source: "manual" });
    expect(create.error?.code).toBe(DENIED);
    const publish = await w.users.adminA.client.rpc("publish_pog_version", {
      p_actor: w.users.adminA.id, p_version_id: SEED.versionA2Draft, p_expected_revision: 1,
    });
    expect(publish.error?.code).toBe(DENIED);
    const anon = await w.anon.rpc("create_scan", { p_actor: w.users.adminA.id, p_display_id: SEED.displayA1, p_source: "manual" });
    expect(anon.error?.code).toBe(DENIED);
  });

  it("anonymous users cannot write; sign-up waits for the email code (Feature 16)", async () => {
    expect((await errorOf(w.anon.from("organizations").insert({ name: "Mine" })))?.code).toBe(DENIED);
    const email = `signup-${w.run}@example.com`;
    const signUp = await w.anon.auth.signUp({ email, password: "a-long-password-123" });
    expect(signUp.error).toBeNull();
    expect(signUp.data.session).toBeNull();
    const signIn = await w.anon.auth.signInWithPassword({ email, password: "a-long-password-123" });
    expect(signIn.error?.code).toBe("email_not_confirmed");
    expect((await w.db.query("select count(*)::int n from public.organization_memberships m join auth.users u on u.id=m.user_id where u.email=$1", [email])).rows[0].n).toBe(0);
  });
});
