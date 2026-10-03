import { describe, expect, it } from "vitest";
import {
  CreateDisplayRequest,
  CreateProductRequest,
  CreateStoreRequest,
  findNonSnakeCaseKeys,
  ListQuery,
  UpdateDisplayRequest,
  UpdateProductRequest,
  UpdateStoreRequest,
} from "../src";

const VERSION = "50000000-0000-4000-8000-0000000000a1";

describe("store requests", () => {
  it("trims values and requires name, number and an IANA-shaped time zone", () => {
    expect(CreateStoreRequest.parse({ name: "  North ", store_number: " N-1 ", timezone: "America/Los_Angeles" })).toEqual({
      name: "North", store_number: "N-1", timezone: "America/Los_Angeles",
    });
    const blank = CreateStoreRequest.safeParse({ name: " ", store_number: "", timezone: "" });
    expect(blank.success).toBe(false);
    expect([...new Set(blank.error!.issues.map((i) => i.path[0]))].sort()).toEqual(["name", "store_number", "timezone"]);
    for (const tz of ["UTC", "Etc/GMT+5", "America/Argentina/Buenos_Aires"]) expect(CreateStoreRequest.safeParse({ name: "a", store_number: "1", timezone: tz }).success, tz).toBe(true);
    for (const tz of ["../etc/passwd", "America/ Los", "+05:00"]) expect(CreateStoreRequest.safeParse({ name: "a", store_number: "1", timezone: tz }).success, tz).toBe(false);
  });

  it("rejects fields a client may not set and empty updates", () => {
    expect(CreateStoreRequest.safeParse({ name: "a", store_number: "1", timezone: "UTC", active: false }).success).toBe(false);
    expect(UpdateStoreRequest.safeParse({ expected_revision: 1 }).success).toBe(false);
    expect(UpdateStoreRequest.safeParse({ expected_revision: 1, organization_id: VERSION, name: "x" }).success).toBe(false);
    expect(UpdateStoreRequest.safeParse({ expected_revision: 0, name: "x" }).success).toBe(false);
    expect(UpdateStoreRequest.safeParse({ expected_revision: 2, active: false }).success).toBe(true);
  });
});

describe("product requests", () => {
  it("accepts optional codes as null, validates UPC digits", () => {
    const base = { name: "Cobb", short_name: "Cobb", category: "salad", container_type: "clamshell" };
    expect(CreateProductRequest.parse({ ...base, sku: null, upc: "012345678905" })).toMatchObject({ sku: null, upc: "012345678905" });
    for (const upc of ["12345", "123456789012345", "12-34-56", "abcdef"]) expect(CreateProductRequest.safeParse({ ...base, upc }).success, upc).toBe(false);
    expect(CreateProductRequest.safeParse({ ...base, sku: "" }).success).toBe(false); // blank is sent as null
    expect(UpdateProductRequest.safeParse({ expected_revision: 3, plu: null }).success).toBe(true);
  });
});

describe("display requests", () => {
  it("assignment is a UUID or null (unassign); revision is required for updates", () => {
    expect(CreateDisplayRequest.parse({ name: "Deli" })).toEqual({ name: "Deli" });
    expect(UpdateDisplayRequest.parse({ expected_revision: 1, active_pog_version_id: null })).toEqual({ expected_revision: 1, active_pog_version_id: null });
    expect(UpdateDisplayRequest.safeParse({ expected_revision: 1, active_pog_version_id: "v1" }).success).toBe(false);
    expect(UpdateDisplayRequest.safeParse({ name: "x" }).success).toBe(false);
    expect(UpdateDisplayRequest.safeParse({ expected_revision: 1, store_id: VERSION }).success).toBe(false);
  });
});

describe("list query", () => {
  it("defaults to active, 25 items; caps at 100", () => {
    expect(ListQuery.parse({})).toEqual({ status: "active", limit: 25 });
    expect(ListQuery.parse({ status: "all", limit: "100" })).toEqual({ status: "all", limit: 100 });
    for (const bad of [{ limit: "101" }, { limit: "0" }, { status: "deleted" }, { organization_id: "x" }, { extra: "1" }]) {
      expect(ListQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("request field names follow the snake_case convention", () => {
    expect(findNonSnakeCaseKeys(UpdateDisplayRequest.parse({ expected_revision: 1, active_pog_version_id: VERSION }))).toEqual([]);
  });
});
