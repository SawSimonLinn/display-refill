import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { createWorld, errorOf, type World } from "../src/world";

let w: World;
let draftVersion: string;

const slot = (over: Record<string, unknown> = {}) => ({
  organization_id: SEED.orgA,
  pog_version_id: draftVersion,
  label: `S-${randomUUID().slice(0, 6)}`,
  product_id: SEED.productCobb,
  x: 0.1, y: 0.1, width: 0.2, height: 0.2,
  target_quantity: 3,
  refill_threshold: 1,
  ...over,
});

/** Inserts through the service role: constraints must hold even when RLS is bypassed. */
const insertSlot = (over: Record<string, unknown>) =>
  errorOf(w.service.from("pog_slots").insert(slot(over) as never));

beforeAll(async () => {
  w = await createWorld();
  const pog = await w.service.from("pogs").insert({ organization_id: SEED.orgA, name: `Constraints ${w.run}` }).select("id").single();
  if (pog.error) throw pog.error;
  const version = await w.service
    .from("pog_versions")
    .insert({ organization_id: SEED.orgA, pog_id: pog.data.id, version_number: 1 })
    .select("id")
    .single();
  if (version.error) throw version.error;
  draftVersion = version.data.id;
});
afterAll(() => w?.close());

describe("slot coordinates", () => {
  it.each([
    ["negative x", { x: -0.1 }],
    ["x = 1", { x: 1 }],
    ["zero width", { width: 0 }],
    ["width > 1", { width: 1.2 }],
    ["x + width > 1", { x: 0.9, width: 0.2 }],
    ["y + height > 1", { y: 0.85, height: 0.2 }],
  ])("rejects %s", async (_label, over) => {
    expect((await insertSlot(over))?.code).toBe("23514");
  });

  it("accepts a rectangle touching the edges", async () => {
    expect(await insertSlot({ x: 0, y: 0, width: 1, height: 0.05 })).toBeUndefined();
  });
});

describe("quantities and thresholds", () => {
  it.each([
    ["fractional target", { target_quantity: 2.5 }, "22P02"],
    ["target 0", { target_quantity: 0 }, "23514"],
    ["target 1000", { target_quantity: 1000 }, "23514"],
    ["negative threshold", { refill_threshold: -1 }, "23514"],
    ["threshold above target", { target_quantity: 3, refill_threshold: 4 }, "23514"],
    ["fractional threshold", { refill_threshold: 1.5 }, "22P02"],
  ])("rejects %s", async (_label, over, code) => {
    expect((await insertSlot(over))?.code).toBe(code);
  });

  it("accepts a null threshold (always top up) and threshold = target", async () => {
    expect(await insertSlot({ refill_threshold: null })).toBeUndefined();
    expect(await insertSlot({ target_quantity: 2, refill_threshold: 2 })).toBeUndefined();
  });

  it("rejects fractional, out-of-range and NaN observations on scan slots", async () => {
    const created = await w.service.rpc("create_scan", { p_actor: w.users.employeeA1.id, p_display_id: SEED.displayA1, p_source: "photo" });
    if (created.error) throw created.error;
    const scanId = created.data[0]!.scan_id;
    const target = { scan_id: scanId };
    for (const [patch, code] of [
      [{ ai_quantity: 1.5 }, "22P02"],
      [{ ai_quantity: 1000 }, "23514"],
      [{ ai_quantity: -1 }, "23514"],
      [{ ai_confidence: 1.2 }, "23514"],
      [{ ai_confidence: "NaN" }, "23514"],
      [{ accepted_quantity: 2.25 }, "22P02"],
      [{ ai_flags: ["sticky"] }, "23514"],
    ] as const) {
      const error = await errorOf(w.service.from("scan_slots").update(patch as never).match(target));
      expect(error?.code, JSON.stringify(patch)).toBe(code);
    }
  });
});

describe("tenant consistency", () => {
  it("rejects a slot whose product belongs to another organization", async () => {
    expect((await insertSlot({ product_id: SEED.productB }))?.code).toBe("23503");
  });

  it("rejects a store membership pointing at another organization's store", async () => {
    const error = await errorOf(
      w.service.from("store_memberships").insert({
        organization_id: SEED.orgB, store_id: SEED.storeA1, user_id: w.users.adminB.id, role: "manager",
      }),
    );
    expect(error?.code).toBe("23503");
  });

  it("rejects a store membership without an organization membership", async () => {
    const error = await errorOf(
      w.service.from("store_memberships").insert({
        organization_id: SEED.orgA, store_id: SEED.storeA1, user_id: w.users.outsider.id, role: "employee",
      }),
    );
    expect(error?.code).toBe("23503");
  });

  it("rejects assigning another organization's POG version to a display", async () => {
    const error = await errorOf(w.service.from("displays").update({ active_pog_version_id: SEED.versionB1 }).eq("id", SEED.displayA1));
    expect(error?.code).toBe("23503");
  });

  it("rejects assigning a draft version to a display", async () => {
    const error = await errorOf(w.service.from("displays").update({ active_pog_version_id: SEED.versionA2Draft }).eq("id", SEED.displayA1));
    expect(error?.message).toBe("VALIDATION_FAILED");
  });

  it("rejects a scan whose display belongs to a different store", async () => {
    const error = await errorOf(
      w.service.from("scans").insert({
        organization_id: SEED.orgA, store_id: SEED.storeA2, display_id: SEED.displayA1, pog_version_id: SEED.versionA1,
        created_by: w.users.employeeA1.id, source: "manual", status: "needs_review",
      }),
    );
    expect(error?.code).toBe("23503");
  });

  it("rejects a scan slot pointing at a slot of a different POG version", async () => {
    const created = await w.service.rpc("create_scan", { p_actor: w.users.employeeA1.id, p_display_id: SEED.displayA1, p_source: "manual" });
    if (created.error) throw created.error;
    const error = await errorOf(
      w.service.from("scan_slots").insert({
        organization_id: SEED.orgA, scan_id: created.data[0]!.scan_id, pog_version_id: SEED.versionA1,
        pog_slot_id: SEED.slotDraft, product_id: SEED.productDraftOnly, product_name_snapshot: "x",
        slot_label_snapshot: "x", target_snapshot: 1,
      }),
    );
    expect(error?.code).toBe("23503");
  });

  it("rejects an upload intent path outside its organization", async () => {
    const error = await errorOf(
      w.service.from("upload_intents").insert({
        organization_id: SEED.orgA, store_id: SEED.storeA1, actor_id: w.users.employeeA1.id, resource_id: randomUUID(),
        bucket: "display-scans", object_path: `${SEED.orgB}/${SEED.storeB1}/x/capture.jpg`,
        expires_at: new Date(Date.now() + 60_000).toISOString(), expected_type: "image/jpeg", max_bytes: 1000,
      }),
    );
    expect(error?.code).toBe("23514");
  });

  it("rejects an invalid store time zone", async () => {
    const error = await errorOf(
      w.service.from("stores").insert({ organization_id: SEED.orgA, name: "Bad tz", store_number: `TZ-${w.run}`, timezone: "Mars/Olympus" }),
    );
    expect(error?.message).toBe("VALIDATION_FAILED");
  });
});

describe("published POG immutability (service role and direct SQL)", () => {
  it("rejects slot updates, inserts and deletes on a published version", async () => {
    expect((await errorOf(w.service.from("pog_slots").update({ target_quantity: 9 }).eq("id", SEED.slotA1)))?.message).toBe("IMMUTABLE");
    expect((await errorOf(w.service.from("pog_slots").delete().eq("id", SEED.slotA1)))?.message).toBe("IMMUTABLE");
    expect(
      (await errorOf(w.service.from("pog_slots").insert(slot({ pog_version_id: SEED.versionA1, x: 0.46, width: 0.05 }) as never)))?.message,
    ).toBe("IMMUTABLE");
  });

  it("rejects moving a draft slot into a published version", async () => {
    const created = await w.service.from("pog_slots").insert(slot({ x: 0.7, width: 0.1 }) as never).select("id").single();
    if (created.error) throw created.error;
    const error = await errorOf(w.service.from("pog_slots").update({ pog_version_id: SEED.versionA1 }).eq("id", created.data.id));
    expect(error).toBeDefined();
  });

  it("rejects editing, unpublishing or deleting a published version", async () => {
    expect((await errorOf(w.service.from("pog_versions").update({ reference_width: 10 }).eq("id", SEED.versionA1)))?.message).toBe("IMMUTABLE");
    expect(
      (await errorOf(w.service.from("pog_versions").update({ state: "draft", published_at: null }).eq("id", SEED.versionA1)))?.message,
    ).toBe("IMMUTABLE");
    expect((await errorOf(w.service.from("pog_versions").delete().eq("id", SEED.versionA1)))?.message).toBe("IMMUTABLE");
  });

  it("holds for the database owner too", async () => {
    await expect(w.db.query("update public.pog_slots set target_quantity = 9 where id = $1", [SEED.slotA1])).rejects.toThrow("IMMUTABLE");
    const { rows: [row] } = await w.db.query("select target_quantity from public.pog_slots where id = $1", [SEED.slotA1]);
    expect(row.target_quantity).toBe(3);
  });

  it("rejects creating a version directly as published", async () => {
    const error = await errorOf(
      w.service.from("pog_versions").insert({
        organization_id: SEED.orgA, pog_id: SEED.pogA, version_number: 99, state: "published", published_at: new Date().toISOString(),
      }),
    );
    expect(error?.message).toBe("VALIDATION_FAILED");
  });
});

describe("history protection", () => {
  it("scans cannot be deleted or re-pointed; corrections are append-only", async () => {
    const created = await w.service.rpc("create_scan", { p_actor: w.users.employeeA1.id, p_display_id: SEED.displayA1, p_source: "manual" });
    if (created.error) throw created.error;
    const scanId = created.data[0]!.scan_id;
    expect((await errorOf(w.service.from("scans").delete().eq("id", scanId)))?.message).toBe("IMMUTABLE");
    expect((await errorOf(w.service.from("scans").update({ display_id: SEED.displayA1Unassigned }).eq("id", scanId)))?.message).toBe("IMMUTABLE");

    const [scanSlot] = (await w.service.from("scan_slots").select("id").eq("scan_id", scanId)).data!;
    const correction = await w.service
      .from("scan_corrections")
      .insert({
        organization_id: SEED.orgA, scan_id: scanId, scan_slot_id: scanSlot!.id, actor_id: w.users.employeeA1.id,
        corrected_quantity: 2, scan_revision: 1, reason: "manual_count",
      })
      .select("id")
      .single();
    if (correction.error) throw correction.error;
    expect((await errorOf(w.service.from("scan_corrections").update({ corrected_quantity: 3 }).eq("id", correction.data.id)))?.message).toBe("IMMUTABLE");
    expect((await errorOf(w.service.from("scan_corrections").delete().eq("id", correction.data.id)))?.message).toBe("IMMUTABLE");
    expect((await errorOf(w.service.from("scan_slots").update({ product_name_snapshot: "Renamed" }).eq("id", scanSlot!.id)))?.message).toBe("IMMUTABLE");
  });

  it("an organization cannot lose its last active admin", async () => {
    const org = await w.service.from("organizations").insert({ name: `Last admin ${w.run}` }).select("id").single();
    if (org.error) throw org.error;
    const solo = await w.user("solo-admin", { org: { id: org.data.id, role: "admin" } });
    const deactivate = () => w.service.from("organization_memberships").update({ active: false }).eq("user_id", solo.id);
    expect((await errorOf(deactivate()))?.message).toBe("LAST_ADMIN");
    expect((await errorOf(w.service.from("organization_memberships").update({ role: "member" }).eq("user_id", solo.id)))?.message).toBe("LAST_ADMIN");
    await w.user("second-admin", { org: { id: org.data.id, role: "admin" } });
    expect(await errorOf(deactivate())).toBeUndefined();
  });
});
