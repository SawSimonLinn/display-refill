import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { type Client, createWorld, rows, type World } from "../src/world";

let w: World;
let scanA1: string; // created by employeeA1 in store A1
let scanB1: string; // created by adminB in store B1

const ids = async (client: Client, table: "stores" | "displays" | "products" | "pogs" | "pog_versions" | "scans") =>
  (await rows<{ id: string }>(client.from(table).select("id"))).map((r) => r.id).sort();

beforeAll(async () => {
  w = await createWorld();
  const a = await w.service.rpc("create_scan", { p_actor: w.users.employeeA1.id, p_display_id: SEED.displayA1, p_source: "manual" });
  const b = await w.service.rpc("create_scan", { p_actor: w.users.adminB.id, p_display_id: SEED.displayB1, p_source: "manual" });
  if (a.error || b.error) throw a.error ?? b.error;
  scanA1 = a.data[0]!.scan_id;
  scanB1 = b.data[0]!.scan_id;
});
afterAll(() => w?.close());

describe("stores and displays", () => {
  it("each role sees exactly its stores", async () => {
    const { adminA, managerA1, employeeA1, employeeA2, adminB } = w.users;
    expect(await ids(adminA.client, "stores")).toEqual([SEED.storeA1, SEED.storeA2]);
    expect(await ids(managerA1.client, "stores")).toEqual([SEED.storeA1]);
    expect(await ids(employeeA1.client, "stores")).toEqual([SEED.storeA1]);
    expect(await ids(employeeA2.client, "stores")).toEqual([SEED.storeA2]);
    expect(await ids(adminB.client, "stores")).toEqual([SEED.storeB1]);
  });

  it("displays follow store access", async () => {
    expect(await ids(w.users.employeeA1.client, "displays")).toEqual([SEED.displayA1, SEED.displayA1Unassigned]);
    expect(await ids(w.users.employeeA2.client, "displays")).toEqual([SEED.displayA2]);
    expect(await ids(w.users.adminB.client, "displays")).toEqual([SEED.displayB1]);
  });

  it("cross-store and cross-organization ID substitution returns nothing", async () => {
    const { employeeA1, adminA } = w.users;
    expect(await rows(employeeA1.client.from("stores").select("id").eq("id", SEED.storeA2))).toEqual([]);
    expect(await rows(employeeA1.client.from("displays").select("id").eq("id", SEED.displayA2))).toEqual([]);
    expect(await rows(adminA.client.from("stores").select("id").eq("id", SEED.storeB1))).toEqual([]);
    expect(await rows(adminA.client.from("products").select("id").eq("organization_id", SEED.orgB))).toEqual([]);
  });

  it("revoked store or organization membership and no membership see nothing", async () => {
    for (const u of [w.users.revokedStoreA1, w.users.revokedOrgA1, w.users.outsider]) {
      for (const table of ["stores", "displays", "products", "pogs", "pog_versions", "scans"] as const) {
        expect(await ids(u.client, table), `${u.email} ${table}`).toEqual([]);
      }
    }
  });
});

describe("catalog and POG visibility", () => {
  it("employees see only products and versions of their assigned layouts", async () => {
    const c = w.users.employeeA1.client;
    expect(await ids(c, "products")).toEqual([SEED.productCobb, SEED.productGarden]);
    expect(await ids(c, "pog_versions")).toEqual([SEED.versionA1]);
    expect(await ids(c, "pogs")).toEqual([SEED.pogA]);
    const slots = await rows<{ id: string }>(c.from("pog_slots").select("id"));
    expect(slots.map((s) => s.id).sort()).toEqual([SEED.slotA1, SEED.slotA2]);
  });

  it("managers see the organization catalog but only published versions", async () => {
    const c = w.users.managerA1.client;
    const products = await ids(c, "products");
    expect(products).toEqual(expect.arrayContaining([SEED.productCobb, SEED.productGarden, SEED.productInactive, SEED.productDraftOnly]));
    expect(products).not.toContain(SEED.productB);
    const versions = await ids(c, "pog_versions");
    expect(versions).toContain(SEED.versionA1);
    expect(versions).not.toContain(SEED.versionA2Draft);
  });

  it("admins also see drafts; never another organization's", async () => {
    const versions = await ids(w.users.adminA.client, "pog_versions");
    expect(versions).toEqual(expect.arrayContaining([SEED.versionA1, SEED.versionA2Draft]));
    expect(versions).not.toContain(SEED.versionB1);
    expect(await ids(w.users.adminB.client, "pog_versions")).not.toContain(SEED.versionA1);
  });
});

describe("scans", () => {
  it("store members and org admins read store scans; others do not", async () => {
    const { adminA, managerA1, employeeA1, employeeA2, adminB } = w.users;
    expect(await ids(employeeA1.client, "scans")).toContain(scanA1);
    expect(await ids(managerA1.client, "scans")).toContain(scanA1);
    expect(await ids(adminA.client, "scans")).toContain(scanA1);
    expect(await ids(employeeA2.client, "scans")).not.toContain(scanA1);
    expect(await ids(adminB.client, "scans")).not.toContain(scanA1);
    expect(await ids(adminA.client, "scans")).not.toContain(scanB1);
  });

  it("scan slots follow scan access", async () => {
    const own = await rows(w.users.employeeA1.client.from("scan_slots").select("id").eq("scan_id", scanA1));
    expect(own).toHaveLength(2);
    expect(await rows(w.users.employeeA2.client.from("scan_slots").select("id").eq("scan_id", scanA1))).toEqual([]);
    expect(await rows(w.users.adminB.client.from("scan_slots").select("id").eq("scan_id", scanA1))).toEqual([]);
  });
});

describe("memberships, profiles and audit", () => {
  it("non-admins see only their own memberships; admins see their organization's", async () => {
    const own = await rows<{ user_id: string }>(w.users.employeeA1.client.from("organization_memberships").select("user_id"));
    expect(own.map((m) => m.user_id)).toEqual([w.users.employeeA1.id]);
    const adminView = await rows<{ user_id: string; organization_id: string }>(
      w.users.adminA.client.from("organization_memberships").select("user_id, organization_id"),
    );
    expect(adminView.map((m) => m.user_id)).toEqual(expect.arrayContaining([w.users.employeeA1.id, w.users.managerA1.id]));
    expect(adminView.every((m) => m.organization_id === SEED.orgA)).toBe(true);
    const storeView = await rows<{ user_id: string }>(w.users.managerA1.client.from("store_memberships").select("user_id"));
    expect(storeView.map((m) => m.user_id)).toEqual([w.users.managerA1.id]);
  });

  it("profiles are not exposed across organizations", async () => {
    const seenByA = await rows<{ user_id: string }>(w.users.adminA.client.from("profiles").select("user_id"));
    expect(seenByA.map((p) => p.user_id)).not.toContain(w.users.adminB.id);
    const seenByEmployee = await rows<{ user_id: string }>(w.users.employeeA1.client.from("profiles").select("user_id"));
    expect(seenByEmployee.map((p) => p.user_id)).toEqual([w.users.employeeA1.id]);
  });

  it("audit events are visible to org admins only", async () => {
    expect(await rows(w.users.employeeA1.client.from("audit_events").select("id"))).toEqual([]);
    expect(await rows(w.users.managerA1.client.from("audit_events").select("id"))).toEqual([]);
  });
});

describe("anonymous access", () => {
  it("is denied for every application table", async () => {
    const tables = [
      "organizations", "profiles", "organization_memberships", "stores", "store_memberships", "products", "pogs",
      "pog_versions", "pog_slots", "displays", "scans", "scan_slots", "scan_corrections", "scan_confirmations",
      "scan_jobs", "scan_attempts", "upload_intents", "idempotency_records", "audit_events",
    ] as const;
    for (const table of tables) {
      const { data, error } = await w.anon.from(table).select("*").limit(1);
      expect(error?.code, table).toBe("42501");
      expect(data, table).toBeNull();
    }
  });
});
