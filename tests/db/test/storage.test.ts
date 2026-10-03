import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { createWorld, type World } from "../src/world";

let w: World;
let scanPath: string;
const pogPath = `${SEED.orgA}/${SEED.pogA}/${SEED.versionA1}/reference.jpg`;
// Smallest useful JPEG-typed body; content validation is feature 08.
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

beforeAll(async () => {
  w = await createWorld();
  const created = await w.service.rpc("create_scan", { p_actor: w.users.employeeA1.id, p_display_id: SEED.displayA1, p_source: "photo" });
  if (created.error) throw created.error;
  scanPath = created.data[0]!.upload_object_path!;
  // The trusted server can write objects.
  for (const [bucket, path] of [["display-scans", scanPath], ["pog-images", pogPath]] as const) {
    const up = await w.service.storage.from(bucket).upload(path, jpeg, { upsert: true, contentType: "image/jpeg" });
    if (up.error) throw up.error;
  }
});
afterAll(async () => {
  await w?.service.storage.from("display-scans").remove([scanPath]);
  await w?.close();
});

describe("private buckets", () => {
  it("are configured private, JPEG-only, 10 MiB", async () => {
    for (const id of ["display-scans", "pog-images"]) {
      const { data, error } = await w.service.storage.getBucket(id);
      expect(error).toBeNull();
      expect(data).toMatchObject({ public: false, file_size_limit: 10485760, allowed_mime_types: ["image/jpeg"] });
    }
  });

  it.each([
    ["display-scans", () => scanPath],
    ["pog-images", () => pogPath],
  ])("%s: anonymous list, download, signed link and upload all fail", async (bucket, path) => {
    const objects = w.anon.storage.from(bucket);
    const listed = await objects.list(SEED.orgA);
    expect(listed.data ?? []).toEqual([]);
    expect((await objects.download(path())).error).not.toBeNull();
    expect((await objects.createSignedUrl(path(), 60)).error).not.toBeNull();
    expect((await objects.upload(`${SEED.orgA}/anon.jpg`, jpeg)).error).not.toBeNull();
    const publicUrl = objects.getPublicUrl(path()).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
  });

  it.each([
    ["display-scans", () => scanPath],
    ["pog-images", () => pogPath],
  ])("%s: even users with store access cannot read or write objects directly", async (bucket, path) => {
    const objects = w.users.employeeA1.client.storage.from(bucket);
    expect((await objects.list(SEED.orgA)).data ?? []).toEqual([]);
    expect((await objects.download(path())).error).not.toBeNull();
    expect((await objects.createSignedUrl(path(), 60)).error).not.toBeNull();
    // Guessed or arbitrary paths, and overwriting the real object, are rejected.
    expect((await objects.upload(`${SEED.orgA}/${SEED.storeA1}/guessed/capture.jpg`, jpeg)).error).not.toBeNull();
    expect((await objects.upload(path(), jpeg, { upsert: true })).error).not.toBeNull();
    expect((await objects.remove([path()])).data ?? []).toEqual([]);
    expect((await w.service.storage.from(bucket).exists(path())).data).toBe(true);
  });

  it("org admins have no direct object access either (links come from the API)", async () => {
    const objects = w.users.adminA.client.storage.from("display-scans");
    expect((await objects.download(scanPath)).error).not.toBeNull();
  });
});
