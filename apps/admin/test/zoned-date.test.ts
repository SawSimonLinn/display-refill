import { describe, expect, it } from "vitest";
import { dayRange, startOfDay } from "@/lib/zoned-date";

describe("history date filters in a store's time zone", () => {
  it("uses the zone's midnight, including across daylight-saving changes", () => {
    expect(startOfDay("2026-10-03", "UTC")?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(startOfDay("2026-07-01", "America/Toronto")?.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfDay("2026-12-01", "America/Toronto")?.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    // Toronto leaves daylight time on 2026-11-01: that day is 25 hours long.
    expect(dayRange("2026-11-01", "2026-11-01", "America/Toronto")).toEqual({ from: "2026-11-01T04:00:00.000Z", to: "2026-11-02T05:00:00.000Z" });
    expect(startOfDay("2026-10-03", "Asia/Kolkata")?.toISOString()).toBe("2026-10-02T18:30:00.000Z");
  });

  it("treats the end date as inclusive and rejects impossible or reversed ranges", () => {
    expect(dayRange("2026-10-01", "2026-10-03", "UTC")).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" });
    expect(dayRange(undefined, "2026-12-31", "UTC")).toEqual({ from: undefined, to: "2027-01-01T00:00:00.000Z" });
    expect(dayRange("2026-02-30", undefined, "UTC")).toEqual({ error: "Enter the start date as a valid date." });
    expect(dayRange("2026-10-01", "yesterday", "UTC")).toEqual({ error: "Enter the end date as a valid date." });
    expect(dayRange("2026-10-04", "2026-10-03", "UTC")).toEqual({ error: "The end date must be on or after the start date." });
    expect(startOfDay("2026-10-03", "Not/AZone")).toBeNull();
  });
});
