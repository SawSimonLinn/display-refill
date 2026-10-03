import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "../src/world";

// Structural checks over the whole schema, so tables and functions added by
// later migrations are covered automatically.

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w?.close());

const q = async <T>(sql: string, params: unknown[] = []) => (await w.db.query(sql, params)).rows as T[];

describe("schema security invariants", () => {
  it("every public table has RLS enabled", async () => {
    const missing = await q<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(missing).toEqual([]);
  });

  it("anon holds no privileges on public tables", async () => {
    const granted = await q<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
        and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`);
    expect(granted).toEqual([]);
  });

  it("authenticated can only SELECT public tables", async () => {
    const writable = await q<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`);
    expect(writable).toEqual([]);
  });

  it("client roles cannot execute any public function", async () => {
    const callable = await q<{ proname: string; role: string }>(`
      select p.proname, r.role from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) r(role)
      where n.nspname = 'public' and has_function_privilege(r.role, p.oid, 'EXECUTE')`);
    expect(callable).toEqual([]);
  });

  it("every SECURITY DEFINER function in app schemas pins search_path", async () => {
    const unpinned = await q<{ name: string }>(`
      select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(unpinned).toEqual([]);
  });

  it("private helpers are not executable by anon", async () => {
    const callable = await q<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE')`);
    expect(callable).toEqual([]);
  });

  it("new tables created later get no client grants by default", async () => {
    await w.db.query("begin");
    try {
      await w.db.query("create table public.__default_priv_probe (id int)");
      const [row] = await q<{ anon: boolean; auth: boolean }>(`
        select has_table_privilege('anon', 'public.__default_priv_probe', 'SELECT') as anon,
               has_table_privilege('authenticated', 'public.__default_priv_probe', 'SELECT, INSERT') as auth`);
      expect(row).toEqual({ anon: false, auth: false });
    } finally {
      await w.db.query("rollback");
    }
  });

  it("every public table with organization_id has an index leading with it", async () => {
    const unindexed = await q<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)`);
    expect(unindexed).toEqual([]);
  });

  it("no role column exists on profiles", async () => {
    const cols = await q<{ column_name: string }>(`
      select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'`);
    expect(cols.map((c) => c.column_name)).not.toContain("role");
  });
});
