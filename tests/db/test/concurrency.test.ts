import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "../src/seed-ids";
import { createWorld, type World } from "../src/world";

// Two raw connections interleave a publication with a slot write. Both run as
// the database owner, so only triggers and locks (not RLS) decide the outcome.
let w: World;
let publisher: pg.Client;
let editor: pg.Client;

/** A publishable org-A draft with one slot covering the left half. */
async function draft() {
  const pog = await w.db.query<{ id: string }>(
    "insert into public.pogs (organization_id, name) values ($1, $2) returning id", [SEED.orgA, `Race ${w.run}`],
  );
  const pogId = pog.rows[0]!.id;
  const version = await w.db.query<{ id: string }>(
    "insert into public.pog_versions (organization_id, pog_id, version_number) values ($1, $2, 1) returning id", [SEED.orgA, pogId],
  );
  const id = version.rows[0]!.id;
  await w.db.query(
    `update public.pog_versions set reference_path = $2, reference_width = 1600, reference_height = 1200, reference_validated_at = now() where id = $1`,
    [id, `${SEED.orgA}/${pogId}/${id}/reference.jpg`],
  );
  await insertSlot(w.db, id, "L1", 0);
  const current = await w.db.query<{ revision: number }>("select revision from public.pog_versions where id = $1", [id]);
  return { id, revision: current.rows[0]!.revision };
}

/** Left half at x = 0; an x of 0.25 overlaps it. */
const insertSlot = (client: pg.Client, version: string, label: string, x: number) =>
  client.query(
    `insert into public.pog_slots (organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity)
     values ($1, $2, $3, $4, $5, 0, 0.5, 1, 3)`,
    [SEED.orgA, version, label, SEED.productCobb, x],
  );

const publishSql = "select state from public.publish_pog_version($1, $2, $3)";

async function slotLabels(version: string) {
  const { rows } = await w.db.query<{ label: string }>(
    "select label from public.pog_slots where pog_version_id = $1 order by label", [version],
  );
  return rows.map((r) => r.label);
}

/** Settles a query promise to its error message (or null), so a pending query never rejects unobserved. */
const settle = (query: Promise<unknown>) => query.then(() => null, (e: Error) => e.message);

beforeAll(async () => {
  w = await createWorld();
  publisher = new pg.Client({ connectionString: w.env.dbUrl });
  editor = new pg.Client({ connectionString: w.env.dbUrl });
  await Promise.all([publisher.connect(), editor.connect()]);
});
afterAll(async () => {
  await Promise.all([publisher?.end(), editor?.end()]);
  await w?.close();
});

describe("publication vs. concurrent slot edits", () => {
  it("rejects a slot written while the publish transaction is open", async () => {
    const v = await draft();
    await publisher.query("begin");
    try {
      await publisher.query(publishSql, [w.users.adminA.id, v.id, v.revision]);
      const insert = settle(insertSlot(editor, v.id, "L2", 0.25)); // overlapping; must wait for the publisher
      await sleep(300);
      await publisher.query("commit");
      expect(await insert).toBe("IMMUTABLE");
    } finally {
      await publisher.query("rollback").catch(() => undefined);
    }
    const { rows } = await w.db.query<{ state: string }>("select state from public.pog_versions where id = $1", [v.id]);
    expect(rows[0]!.state).toBe("published");
    expect(await slotLabels(v.id)).toEqual(["L1"]);
  });

  it("validates a slot that committed while publication waited", async () => {
    const v = await draft();
    await editor.query("begin");
    try {
      await insertSlot(editor, v.id, "L2", 0.25);
      const publish = settle(publisher.query(publishSql, [w.users.adminA.id, v.id, v.revision]));
      await sleep(300);
      await editor.query("commit");
      expect(await publish).toBe("VALIDATION_FAILED");
    } finally {
      await editor.query("rollback").catch(() => undefined);
    }
    const { rows } = await w.db.query<{ state: string }>("select state from public.pog_versions where id = $1", [v.id]);
    expect(rows[0]!.state).toBe("draft");
  });

  it("does not publish with a product archived by a concurrent transaction", async () => {
    const v = await draft();
    const product = await w.db.query<{ id: string }>(
      `insert into public.products (organization_id, name, short_name, category, container_type)
       values ($1, $2, 'Race', 'salad', 'clamshell') returning id`,
      [SEED.orgA, `Race product ${w.run}`],
    );
    await w.db.query("update public.pog_slots set product_id = $2 where pog_version_id = $1", [v.id, product.rows[0]!.id]);
    const { rows: current } = await w.db.query<{ revision: number }>("select revision from public.pog_versions where id = $1", [v.id]);

    await editor.query("begin");
    try {
      await editor.query("update public.products set active = false where id = $1", [product.rows[0]!.id]);
      const publish = settle(publisher.query(publishSql, [w.users.adminA.id, v.id, current[0]!.revision]));
      await sleep(300);
      await editor.query("commit");
      expect(await publish).toBe("VALIDATION_FAILED");
    } finally {
      await editor.query("rollback").catch(() => undefined);
    }
  });
});

describe("scan pinning", () => {
  it("rejects a scan pinned to a draft version, even for the database owner", async () => {
    const error = await settle(
      w.db.query(
        `insert into public.scans (organization_id, store_id, display_id, pog_version_id, created_by, source, status)
         values ($1, $2, $3, $4, $5, 'manual', 'needs_review')`,
        [SEED.orgA, SEED.storeA1, SEED.displayA1, SEED.versionA2Draft, w.users.employeeA1.id],
      ),
    );
    expect(error).toBe("VALIDATION_FAILED");
  });
});
