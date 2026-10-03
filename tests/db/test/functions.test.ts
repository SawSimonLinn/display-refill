import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { createWorld, rows, type World } from "../src/world";

let w: World;

/** A fresh org-A draft with the given rectangles; returns the version ID. */
async function draft(slots: Array<{ x: number; y: number; width: number; height: number; product_id?: string }>) {
  const pog = await w.service.from("pogs").insert({ organization_id: SEED.orgA, name: `Publish ${w.run}` }).select("id").single();
  if (pog.error) throw pog.error;
  const version = await w.service
    .from("pog_versions")
    .insert({ organization_id: SEED.orgA, pog_id: pog.data.id, version_number: 1 })
    .select("id")
    .single();
  if (version.error) throw version.error;
  const id = version.data.id;
  const reference = await w.service
    .from("pog_versions")
    .update({ reference_path: `${SEED.orgA}/${pog.data.id}/${id}/reference.jpg`, reference_width: 1600, reference_height: 1200 })
    .eq("id", id);
  if (reference.error) throw reference.error;
  if (slots.length) {
    const inserted = await w.service.from("pog_slots").insert(
      slots.map((s, i) => ({
        organization_id: SEED.orgA, pog_version_id: id, label: `L${i + 1}`, product_id: s.product_id ?? SEED.productCobb,
        x: s.x, y: s.y, width: s.width, height: s.height, target_quantity: 3, sort_order: i,
      })),
    );
    if (inserted.error) throw inserted.error;
  }
  const { data } = await w.service.from("pog_versions").select("revision").eq("id", id).single();
  return { id, revision: data!.revision };
}

const publish = (actor: string, versionId: string, revision: number) =>
  w.service.rpc("publish_pog_version", { p_actor: actor, p_version_id: versionId, p_expected_revision: revision, p_request_id: crypto.randomUUID() });

beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w?.close());

describe("publish_pog_version", () => {
  const halves = [
    { x: 0, y: 0, width: 0.5, height: 1 },
    { x: 0.5, y: 0, width: 0.5, height: 1 }, // touches, does not overlap
  ];

  it("publishes a valid draft atomically and records an audit event", async () => {
    const v = await draft(halves);
    const { data, error } = await publish(w.users.adminA.id, v.id, v.revision);
    expect(error).toBeNull();
    expect(data).toMatchObject({ state: "published", published_by: w.users.adminA.id });
    const audit = await rows<{ actor_id: string | null }>(w.users.adminA.client.from("audit_events").select("actor_id").eq("resource_id", v.id));
    expect(audit).toEqual([{ actor_id: w.users.adminA.id }]);
  });

  it.each([
    ["overlapping rectangles", [{ x: 0, y: 0, width: 0.6, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }]],
    ["no slots", []],
    ["an inactive product", [{ x: 0, y: 0, width: 0.5, height: 0.5, product_id: SEED.productInactive }]],
  ])("rejects %s and leaves the draft unchanged", async (_label, slots) => {
    const v = await draft(slots);
    const { error } = await publish(w.users.adminA.id, v.id, v.revision);
    expect(error?.message).toBe("VALIDATION_FAILED");
    const { data } = await w.service.from("pog_versions").select("state").eq("id", v.id).single();
    expect(data?.state).toBe("draft");
  });

  it("requires the expected revision and refuses to publish twice", async () => {
    const v = await draft(halves);
    expect((await publish(w.users.adminA.id, v.id, v.revision + 1)).error?.message).toBe("CONFLICT");
    expect((await publish(w.users.adminA.id, v.id, v.revision)).error).toBeNull();
    expect((await publish(w.users.adminA.id, v.id, v.revision)).error?.message).toBe("CONFLICT");
  });

  it("is admin-only and organization-scoped", async () => {
    const v = await draft(halves);
    expect((await publish(w.users.managerA1.id, v.id, v.revision)).error?.message).toBe("FORBIDDEN");
    expect((await publish(w.users.employeeA1.id, v.id, v.revision)).error?.message).toBe("FORBIDDEN");
    // Another organization's admin learns nothing about the version.
    expect((await publish(w.users.adminB.id, v.id, v.revision)).error?.message).toBe("NOT_FOUND");
    expect((await publish(w.users.revokedOrgA1.id, v.id, v.revision)).error?.message).toBe("NOT_FOUND");
  });
});

describe("create_scan", () => {
  const create = (actor: string, display: string, source = "manual", expected?: string) =>
    w.service.rpc("create_scan", {
      p_actor: actor, p_display_id: display, p_source: source, ...(expected ? { p_expected_pog_version_id: expected } : {}),
    });

  it("creates a manual scan with one unknown, review-required row per pinned slot", async () => {
    const { data, error } = await create(w.users.employeeA1.id, SEED.displayA1);
    expect(error).toBeNull();
    const result = data![0]!;
    expect(result).toMatchObject({ status: "needs_review", revision: 1, pog_version_id: SEED.versionA1, slot_count: 2, upload_object_path: null });
    const slots = await rows(
      w.service
        .from("scan_slots")
        .select("pog_slot_id, product_name_snapshot, target_snapshot, threshold_snapshot, accepted_quantity, ai_quantity, review_required, review_state")
        .eq("scan_id", result.scan_id)
        .order("slot_label_snapshot"),
    );
    expect(slots).toEqual([
      { pog_slot_id: SEED.slotA1, product_name_snapshot: "Individual Cobb Salad", target_snapshot: 3, threshold_snapshot: 1,
        accepted_quantity: null, ai_quantity: null, review_required: true, review_state: "pending" },
      { pog_slot_id: SEED.slotA2, product_name_snapshot: "Individual Garden Salad", target_snapshot: 3, threshold_snapshot: null,
        accepted_quantity: null, ai_quantity: null, review_required: true, review_state: "pending" },
    ]);
  });

  it("creates a photo scan with a server-generated upload intent", async () => {
    const { data, error } = await create(w.users.managerA1.id, SEED.displayA1, "photo");
    expect(error).toBeNull();
    const r = data![0]!;
    expect(r.status).toBe("awaiting_upload");
    expect(r.upload_bucket).toBe("display-scans");
    expect(r.upload_object_path).toBe(`${SEED.orgA}/${SEED.storeA1}/${r.scan_id}/capture.jpg`);
    const ttl = new Date(r.upload_expires_at!).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(8 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000); // allow host/DB clock skew
  });

  it("denies users without access to the display's store, without disclosing it", async () => {
    for (const actor of [w.users.employeeA2, w.users.adminB, w.users.revokedStoreA1, w.users.revokedOrgA1, w.users.outsider]) {
      expect((await create(actor.id, SEED.displayA1)).error?.message, actor.email).toBe("NOT_FOUND");
    }
  });

  it("reports an unassigned display and a changed POG", async () => {
    expect((await create(w.users.employeeA1.id, SEED.displayA1Unassigned)).error?.message).toBe("POG_NOT_ASSIGNED");
    expect((await create(w.users.employeeA1.id, SEED.displayA1, "manual", SEED.versionA2Draft)).error?.message).toBe("POG_CHANGED");
    expect((await create(w.users.employeeA1.id, SEED.displayA1, "manual", SEED.versionA1)).error).toBeNull();
  });

  it("rejects an unknown source", async () => {
    expect((await create(w.users.employeeA1.id, SEED.displayA1, "video")).error?.message).toBe("VALIDATION_FAILED");
  });

  it("keeps snapshots when the product is renamed later", async () => {
    const { data } = await create(w.users.employeeA1.id, SEED.displayA1);
    const scanId = data![0]!.scan_id;
    const rename = await w.service.from("products").update({ name: "Cobb Salad (renamed)" }).eq("id", SEED.productCobb);
    expect(rename.error).toBeNull();
    try {
      const slots = await rows<{ product_name_snapshot: string }>(
        w.service.from("scan_slots").select("product_name_snapshot").eq("scan_id", scanId).eq("pog_slot_id", SEED.slotA1),
      );
      expect(slots).toEqual([{ product_name_snapshot: "Individual Cobb Salad" }]);
    } finally {
      await w.service.from("products").update({ name: "Individual Cobb Salad" }).eq("id", SEED.productCobb);
    }
  });
});
