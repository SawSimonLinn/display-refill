import type {
  AssignedPog,
  CreateDisplayRequest,
  CreatePogRequest,
  CreateProductRequest,
  CreateStoreRequest,
  Display,
  DisplayDetail,
  ListQuery,
  Me,
  Pog,
  PogVersionSummary,
  Product,
  Store,
  UpdateDisplayRequest,
  UpdatePogRequest,
  UpdateProductRequest,
  UpdateStoreRequest,
} from "@display-refill/domain";
import { resolveMemberOrganization } from "./auth";
import type { Json } from "./database.types";
import { fail, fromDbError, ok, type ServiceResult } from "./result";
import type { DbClient } from "./supabase";

/**
 * Store, product, POG identity and display management (feature 04).
 *
 * Reads use the caller-scoped client, so RLS decides visibility; the status
 * filter can only narrow that. Writes call service-role-only database
 * functions that resolve the organization/store from the stored row and
 * re-check the verified actor, so a supplied ID can never widen access.
 */

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

const iso = (value: string) => new Date(value).toISOString();
const isoOrNull = (value: string | null | undefined) => (value ? iso(value) : null);

// ---------------------------------------------------------------------------
// Cursor pagination over (created_at, id), oldest first
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamptz text as PostgREST returns it, e.g. 2026-10-03T18:23:35.955225+00:00
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString("base64url");
}

/** The position a cursor names, or null for anything this API did not issue. */
export function decodeCursor(raw: string): { created_at: string; id: string } | null {
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [createdAt, id] = value as unknown[];
    if (typeof createdAt !== "string" || typeof id !== "string" || !PG_TIMESTAMP.test(createdAt) || !UUID.test(id)) return null;
    return { created_at: createdAt, id };
  } catch {
    return null;
  }
}

/** PostgREST `or` filter selecting rows after the cursor position. */
function afterCursor(raw: string | undefined): ServiceResult<string | null> {
  if (raw === undefined) return ok(null);
  const position = decodeCursor(raw);
  if (!position) return fail("VALIDATION_FAILED", "The request contains invalid values.", { fieldErrors: { cursor: ["is not a valid cursor"] } });
  const t = `"${position.created_at}"`;
  return ok(`created_at.gt.${t},and(created_at.eq.${t},id.gt.${position.id})`);
}

function pageOf<R extends { created_at: string; id: string }, T>(rows: R[], limit: number, map: (row: R) => T): Page<T> {
  const items = rows.slice(0, limit);
  return { items: items.map(map), next_cursor: rows.length > limit ? encodeCursor(items[items.length - 1]!) : null };
}

const archivedForbidden = (what: string) => fail("FORBIDDEN", `Only managers and admins can list archived ${what}.`);

/** Stores the caller actively manages (organization admins are handled separately). */
async function managerStoreIds(caller: DbClient, me: Me): Promise<ServiceResult<string[]>> {
  const orgs = me.organizations.map((o) => o.organization_id);
  if (orgs.length === 0) return ok([]);
  const { data, error } = await caller
    .from("store_memberships")
    .select("store_id")
    .eq("user_id", me.user_id)
    .eq("role", "manager")
    .eq("active", true)
    .in("organization_id", orgs);
  if (error) return fromDbError(error);
  return ok(data.map((r) => r.store_id));
}

const isOrgAdmin = (me: Me, org: string) => me.capabilities.admin_organization_ids.includes(org);
const managesInOrg = (me: Me, org: string) => isOrgAdmin(me, org) || me.stores.some((s) => s.organization_id === org && s.role === "manager");

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const STORE_COLUMNS = "id, organization_id, name, store_number, timezone, active, revision, created_at, updated_at";

type StoreRow = { id: string; organization_id: string; name: string; store_number: string; timezone: string; active: boolean; revision: number; created_at: string; updated_at: string };

export const toStore = (r: StoreRow): Store => ({
  store_id: r.id,
  organization_id: r.organization_id,
  name: r.name,
  store_number: r.store_number,
  timezone: r.timezone,
  active: r.active,
  revision: r.revision,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});

/**
 * Accessible stores. Archived stores are listed only to their organization's
 * admins and to the store's own managers.
 */
export async function listStores(caller: DbClient, me: Me, q: ListQuery): Promise<ServiceResult<Page<Store>>> {
  if (q.organization_id && !me.organizations.some((o) => o.organization_id === q.organization_id)) {
    return fail("NOT_FOUND", "Organization not found.");
  }
  const cursor = afterCursor(q.cursor);
  if (!cursor.ok) return cursor;

  let query = caller.from("stores").select(STORE_COLUMNS).order("created_at").order("id").limit(q.limit + 1);
  if (q.organization_id) query = query.eq("organization_id", q.organization_id);
  if (q.status === "active") {
    query = query.eq("active", true);
  } else {
    const managed = await managerStoreIds(caller, me);
    if (!managed.ok) return managed;
    const admin = me.capabilities.admin_organization_ids;
    const scope = [admin.length ? `organization_id.in.(${admin.join(",")})` : null, managed.value.length ? `id.in.(${managed.value.join(",")})` : null].filter(Boolean);
    if (scope.length === 0) return archivedForbidden("stores");
    query = q.status === "archived" ? query.eq("active", false).or(scope.join(",")) : query.or(["active.eq.true", ...scope].join(","));
  }
  if (cursor.value) query = query.or(cursor.value);

  const { data, error } = await query;
  if (error) return fromDbError(error);
  return ok(pageOf(data, q.limit, toStore));
}

export async function createStore(service: DbClient, actorId: string, organizationId: string, input: CreateStoreRequest, requestId: string): Promise<ServiceResult<Store>> {
  const { data, error } = await service.rpc("create_store", {
    p_actor: actorId,
    p_org: organizationId,
    p_name: input.name,
    p_store_number: input.store_number,
    p_timezone: input.timezone,
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return ok(toStore(data));
}

const changesOf = <T extends { expected_revision: number }>(input: T) => {
  const { expected_revision: _revision, ...changes } = input;
  return changes as unknown as Json;
};

export async function updateStore(service: DbClient, actorId: string, storeId: string, input: UpdateStoreRequest, requestId: string): Promise<ServiceResult<Store>> {
  const { data, error } = await service.rpc("update_store", {
    p_actor: actorId,
    p_store_id: storeId,
    p_expected_revision: input.expected_revision,
    p_changes: changesOf(input),
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return ok(toStore(data));
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCT_COLUMNS = "id, organization_id, name, short_name, category, container_type, sku, plu, upc, active, revision, created_at, updated_at";

type ProductRow = {
  id: string; organization_id: string; name: string; short_name: string; category: string; container_type: string;
  sku: string | null; plu: string | null; upc: string | null; active: boolean; revision: number; created_at: string; updated_at: string;
};

export const toProduct = (r: ProductRow): Product => ({
  product_id: r.id,
  organization_id: r.organization_id,
  name: r.name,
  short_name: r.short_name,
  category: r.category,
  container_type: r.container_type,
  sku: r.sku,
  plu: r.plu,
  upc: r.upc,
  active: r.active,
  revision: r.revision,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});

/**
 * The organization catalog for admins and managers; employees see only the
 * active products their assigned layouts use (RLS).
 */
export async function listProducts(caller: DbClient, me: Me, q: ListQuery): Promise<ServiceResult<Page<Product> & { organization_id: string }>> {
  const org = resolveMemberOrganization(me, q.organization_id);
  if (!org.ok) return org;
  if (q.status !== "active" && !managesInOrg(me, org.value)) return archivedForbidden("products");
  const cursor = afterCursor(q.cursor);
  if (!cursor.ok) return cursor;

  let query = caller.from("products").select(PRODUCT_COLUMNS).eq("organization_id", org.value).order("created_at").order("id").limit(q.limit + 1);
  if (q.status !== "all") query = query.eq("active", q.status === "active");
  if (cursor.value) query = query.or(cursor.value);
  const { data, error } = await query;
  if (error) return fromDbError(error);
  return ok({ organization_id: org.value, ...pageOf(data, q.limit, toProduct) });
}

export async function createProduct(service: DbClient, actorId: string, organizationId: string, input: CreateProductRequest, requestId: string): Promise<ServiceResult<Product>> {
  const { data, error } = await service.rpc("create_product", {
    p_actor: actorId,
    p_org: organizationId,
    p_name: input.name,
    p_short_name: input.short_name,
    p_category: input.category,
    p_container_type: input.container_type,
    p_sku: input.sku ?? undefined,
    p_plu: input.plu ?? undefined,
    p_upc: input.upc ?? undefined,
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return ok(toProduct(data));
}

export async function updateProduct(service: DbClient, actorId: string, productId: string, input: UpdateProductRequest, requestId: string): Promise<ServiceResult<Product>> {
  const { data, error } = await service.rpc("update_product", {
    p_actor: actorId,
    p_product_id: productId,
    p_expected_revision: input.expected_revision,
    p_changes: changesOf(input),
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return ok(toProduct(data));
}

// ---------------------------------------------------------------------------
// POG identities
// ---------------------------------------------------------------------------

const POG_COLUMNS = "id, organization_id, name, kind, archived, revision, created_at, updated_at, pog_versions(id, version_number, state, published_at, pog_slots(count))";

type PogRow = {
  id: string; organization_id: string; name: string; kind: string | null; archived: boolean; revision: number; created_at: string; updated_at: string;
  pog_versions: Array<{ id: string; version_number: number; state: string; published_at: string | null; pog_slots: Array<{ count: number }> }>;
};

const toPog = (r: PogRow): Pog => ({
  pog_id: r.id,
  organization_id: r.organization_id,
  name: r.name,
  kind: r.kind as Pog["kind"],
  archived: r.archived,
  revision: r.revision,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
  versions: [...r.pog_versions]
    .sort((a, b) => b.version_number - a.version_number)
    .map(
      (v): PogVersionSummary => ({
        pog_version_id: v.id,
        version_number: v.version_number,
        state: v.state as PogVersionSummary["state"],
        published_at: isoOrNull(v.published_at),
        slot_count: v.pog_slots[0]?.count ?? 0,
      }),
    ),
});

/**
 * POG identities with the versions the caller may see: admins see drafts,
 * managers published versions, employees only versions their stores use.
 */
export async function listPogs(caller: DbClient, me: Me, q: ListQuery): Promise<ServiceResult<Page<Pog> & { organization_id: string }>> {
  const org = resolveMemberOrganization(me, q.organization_id);
  if (!org.ok) return org;
  if (q.status !== "active" && !managesInOrg(me, org.value)) return archivedForbidden("POGs");
  const cursor = afterCursor(q.cursor);
  if (!cursor.ok) return cursor;

  let query = caller.from("pogs").select(POG_COLUMNS).eq("organization_id", org.value).order("created_at").order("id").limit(q.limit + 1);
  if (q.status !== "all") query = query.eq("archived", q.status === "archived");
  if (cursor.value) query = query.or(cursor.value);
  const { data, error } = await query;
  if (error) return fromDbError(error);
  return ok({ organization_id: org.value, ...pageOf(data as PogRow[], q.limit, toPog) });
}

/** Reads one POG after a trusted write (the function already authorized the actor). */
async function loadPog(service: DbClient, pogId: string): Promise<ServiceResult<Pog>> {
  const { data, error } = await service.from("pogs").select(POG_COLUMNS).eq("id", pogId).single();
  if (error) return fromDbError(error);
  return ok(toPog(data as PogRow));
}

/** Creates the POG identity and its empty draft version 1. */
export async function createPog(service: DbClient, actorId: string, organizationId: string, input: CreatePogRequest, requestId: string): Promise<ServiceResult<Pog>> {
  const { data, error } = await service.rpc("create_pog", { p_actor: actorId, p_org: organizationId, p_name: input.name, p_kind: input.kind, p_request_id: requestId });
  if (error) return fromDbError(error);
  return loadPog(service, data.id);
}

export async function updatePog(service: DbClient, actorId: string, pogId: string, input: UpdatePogRequest, requestId: string): Promise<ServiceResult<Pog>> {
  const { data, error } = await service.rpc("update_pog", {
    p_actor: actorId,
    p_pog_id: pogId,
    p_expected_revision: input.expected_revision,
    p_changes: changesOf(input),
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return loadPog(service, data.id);
}

// ---------------------------------------------------------------------------
// Displays
// ---------------------------------------------------------------------------

// Explicit relationship names: scans also references both displays and
// pog_versions, so PostgREST could otherwise see an ambiguous path.
const VERSION_EMBED = "pog_versions!displays_organization_id_active_pog_version_id_fkey(id, version_number, published_at, pogs(id, name, kind, archived))";
const DISPLAY_COLUMNS = `id, organization_id, store_id, name, active, revision, created_at, updated_at, active_pog_version_id, ${VERSION_EMBED}, scans(created_at)`;

type DisplayRow = {
  id: string; organization_id: string; store_id: string; name: string; active: boolean; revision: number; created_at: string; updated_at: string;
  active_pog_version_id: string | null;
  pog_versions: { id: string; version_number: number; published_at: string | null; pogs: { id: string; name: string; kind: string | null; archived: boolean } | null } | null;
  scans: Array<{ created_at: string }>;
};

const toDisplay = (r: DisplayRow, archivedProductVersions: Set<string>): Display => {
  const v = r.pog_versions;
  return {
    display_id: r.id,
    organization_id: r.organization_id,
    store_id: r.store_id,
    name: r.name,
    active: r.active,
    revision: r.revision,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    active_pog:
      v && v.pogs
        ? { pog_id: v.pogs.id, pog_name: v.pogs.name, pog_kind: v.pogs.kind as AssignedPog["pog_kind"], pog_archived: v.pogs.archived, pog_version_id: v.id, version_number: v.version_number, published_at: isoOrNull(v.published_at) }
        : null,
    latest_scan_at: isoOrNull(r.scans[0]?.created_at),
    has_archived_products: r.active_pog_version_id !== null && archivedProductVersions.has(r.active_pog_version_id),
  };
};

/** Assigned versions that use at least one archived product (admin warning, data-model.md). */
async function versionsWithArchivedProducts(client: DbClient, versionIds: string[]): Promise<ServiceResult<Set<string>>> {
  if (versionIds.length === 0) return ok(new Set());
  const { data, error } = await client
    .from("pog_slots")
    .select("pog_version_id, products!pog_slots_organization_id_product_id_fkey!inner(active)")
    .in("pog_version_id", versionIds)
    .eq("products.active", false);
  if (error) return fromDbError(error);
  return ok(new Set(data.map((r) => r.pog_version_id)));
}

async function withWarnings(client: DbClient, rows: DisplayRow[]): Promise<ServiceResult<(r: DisplayRow) => Display>> {
  const ids = [...new Set(rows.map((r) => r.active_pog_version_id).filter((id): id is string => id !== null))];
  const warned = await versionsWithArchivedProducts(client, ids);
  if (!warned.ok) return warned;
  return ok((r: DisplayRow) => toDisplay(r, warned.value));
}

export type StoreAccess = "admin" | "manager" | "employee";

export interface StoreAccessInfo {
  store_id: string;
  organization_id: string;
  name: string;
  store_number: string;
  active: boolean;
  access: StoreAccess;
}

/** The caller's role in a store they can see (RLS), or NOT_FOUND. */
export async function storeAccess(caller: DbClient, me: Me, storeId: string): Promise<ServiceResult<StoreAccessInfo>> {
  const { data, error } = await caller.from("stores").select("id, organization_id, name, store_number, active").eq("id", storeId).maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail("NOT_FOUND", "Store not found.");
  const info = { store_id: data.id, organization_id: data.organization_id, name: data.name, store_number: data.store_number, active: data.active };
  if (isOrgAdmin(me, data.organization_id)) return ok({ ...info, access: "admin" });
  const managed = await managerStoreIds(caller, me);
  if (!managed.ok) return managed;
  return ok({ ...info, access: managed.value.includes(storeId) ? "manager" : "employee" });
}

/** Displays of one accessible store; archived ones only for its managers and admins. */
export async function listDisplays(caller: DbClient, me: Me, storeId: string, q: ListQuery): Promise<ServiceResult<Page<Display>>> {
  const store = await storeAccess(caller, me, storeId);
  if (!store.ok) return store;
  if (q.status !== "active" && store.value.access === "employee") return archivedForbidden("displays");
  const cursor = afterCursor(q.cursor);
  if (!cursor.ok) return cursor;

  let query = caller
    .from("displays")
    .select(DISPLAY_COLUMNS)
    .eq("store_id", storeId)
    .order("created_at")
    .order("id")
    .order("created_at", { referencedTable: "scans", ascending: false })
    .limit(1, { referencedTable: "scans" })
    .limit(q.limit + 1);
  if (q.status !== "all") query = query.eq("active", q.status === "active");
  if (cursor.value) query = query.or(cursor.value);
  const { data, error } = await query;
  if (error) return fromDbError(error);
  const rows = data as unknown as DisplayRow[];
  const map = await withWarnings(caller, rows.slice(0, q.limit));
  if (!map.ok) return map;
  return ok(pageOf(rows, q.limit, map.value));
}

type DisplayDetailRow = DisplayRow & {
  stores: { id: string; name: string; store_number: string; timezone: string; active: boolean } | null;
  pog_versions:
    | (NonNullable<DisplayRow["pog_versions"]> & {
        pog_slots: Array<{
          id: string; label: string; target_quantity: number; refill_threshold: number | null; sort_order: number;
          products: { id: string; name: string; short_name: string; active: boolean } | null;
        }>;
      })
    | null;
};

/** One display with its store and the assigned layout's slots, as the caller may see it. */
export async function getDisplay(client: DbClient, displayId: string): Promise<ServiceResult<DisplayDetail>> {
  const { data, error } = await client
    .from("displays")
    .select(
      `id, organization_id, store_id, name, active, revision, created_at, updated_at, active_pog_version_id,
       stores!displays_organization_id_store_id_fkey(id, name, store_number, timezone, active),
       pog_versions!displays_organization_id_active_pog_version_id_fkey(id, version_number, published_at, pogs(id, name, kind, archived),
         pog_slots(id, label, target_quantity, refill_threshold, sort_order, products!pog_slots_organization_id_product_id_fkey(id, name, short_name, active))),
       scans(created_at)`,
    )
    .eq("id", displayId)
    .order("created_at", { referencedTable: "scans", ascending: false })
    .limit(1, { referencedTable: "scans" })
    .maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail("NOT_FOUND", "Display not found.");
  const row = data as unknown as DisplayDetailRow;
  const slots = [...(row.pog_versions?.pog_slots ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .flatMap((s) =>
      s.products
        ? [{
            slot_id: s.id, label: s.label, product_id: s.products.id, product_name: s.products.name, product_short_name: s.products.short_name,
            product_active: s.products.active, target_quantity: s.target_quantity, refill_threshold: s.refill_threshold, sort_order: s.sort_order,
          }]
        : [],
    );
  const archivedVersions = new Set(row.active_pog_version_id && slots.some((s) => !s.product_active) ? [row.active_pog_version_id] : []);
  if (!row.stores) return fail("NOT_FOUND", "Display not found.");
  return ok({
    display: toDisplay(row, archivedVersions),
    store: { store_id: row.stores.id, name: row.stores.name, store_number: row.stores.store_number, timezone: row.stores.timezone, active: row.stores.active },
    slots,
  });
}

/** Reads one display after a trusted write (the function already authorized the actor). */
async function loadDisplay(service: DbClient, displayId: string): Promise<ServiceResult<Display>> {
  const detail = await getDisplay(service, displayId);
  return detail.ok ? ok(detail.value.display) : detail;
}

export async function createDisplay(service: DbClient, actorId: string, storeId: string, input: CreateDisplayRequest, requestId: string): Promise<ServiceResult<Display>> {
  const { data, error } = await service.rpc("create_display", {
    p_actor: actorId,
    p_store_id: storeId,
    p_name: input.name,
    p_active_pog_version_id: input.active_pog_version_id ?? undefined,
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return loadDisplay(service, data.id);
}

export async function updateDisplay(service: DbClient, actorId: string, displayId: string, input: UpdateDisplayRequest, requestId: string): Promise<ServiceResult<Display>> {
  const { data, error } = await service.rpc("update_display", {
    p_actor: actorId,
    p_display_id: displayId,
    p_expected_revision: input.expected_revision,
    p_changes: changesOf(input),
    p_request_id: requestId,
  });
  if (error) return fromDbError(error);
  return loadDisplay(service, data.id);
}
