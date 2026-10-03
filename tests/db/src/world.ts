import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@display-refill/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { localSupabase } from "./env";
import { SEED } from "./seed-ids";

export type Client = SupabaseClient<Database>;

export interface TestUser {
  id: string;
  email: string;
  client: Client;
}

type OrgRole = "member" | "admin";
type StoreRole = "employee" | "manager";

interface UserSpec {
  org?: { id: string; role: OrgRole; active?: boolean };
  stores?: Array<{ id: string; role: StoreRole; active?: boolean }>;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Builds the identity matrix from context/testing-and-acceptance.md on top
 * of the seeded organizations. Users are new on every run (random email and
 * password, never stored), so runs do not depend on each other.
 */
export async function createWorld() {
  const env = localSupabase();
  const run = randomUUID().slice(0, 8);
  const service: Client = createClient<Database>(env.apiUrl, env.secretKey, clientOptions);
  const anon: Client = createClient<Database>(env.apiUrl, env.publishableKey, clientOptions);
  const db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();

  async function user(label: string, spec: UserSpec = {}): Promise<TestUser> {
    const email = `${label}-${run}@example.com`;
    const password = randomBytes(24).toString("base64url");
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("createUser failed");
    const id = created.data.user.id;

    if (spec.org) {
      const { error } = await service.from("organization_memberships").insert({
        organization_id: spec.org.id, user_id: id, role: spec.org.role, active: spec.org.active ?? true,
      });
      if (error) throw error;
    }
    for (const store of spec.stores ?? []) {
      const { error } = await service.from("store_memberships").insert({
        organization_id: spec.org!.id, store_id: store.id, user_id: id, role: store.role, active: store.active ?? true,
      });
      if (error) throw error;
    }

    const client: Client = createClient<Database>(env.apiUrl, env.publishableKey, clientOptions);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return { id, email, client };
  }

  const users = {
    adminA: await user("admin-a", { org: { id: SEED.orgA, role: "admin" } }),
    managerA1: await user("manager-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "manager" }] }),
    employeeA1: await user("employee-a1", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee" }] }),
    employeeA2: await user("employee-a2", { org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA2, role: "employee" }] }),
    adminB: await user("admin-b", { org: { id: SEED.orgB, role: "admin" } }),
    revokedStoreA1: await user("revoked-store-a1", {
      org: { id: SEED.orgA, role: "member" }, stores: [{ id: SEED.storeA1, role: "employee", active: false }],
    }),
    revokedOrgA1: await user("revoked-org-a1", {
      org: { id: SEED.orgA, role: "member", active: false }, stores: [{ id: SEED.storeA1, role: "employee" }],
    }),
    outsider: await user("outsider"),
  };

  return {
    env,
    run,
    service,
    anon,
    db,
    users,
    user,
    async close() {
      await db.end();
    },
  };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

/** Rows returned by a client SELECT, failing the test on transport errors. */
export async function rows<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Message of a Postgres/PostgREST error, or undefined on success. */
export async function errorOf(query: PromiseLike<{ error: { message: string; code?: string } | null }>) {
  const { error } = await query;
  return error ?? undefined;
}
