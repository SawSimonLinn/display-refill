"use client";

import { useEffect, useState } from "react";
import { type ApiFailure, apiRequest } from "@/lib/api-client";
import { ArchivedBadge } from "../catalog/list-parts";
import { errorsFor, FailureNotice, SecondaryButton, SelectField, SubmitButton, TextField, useMutation } from "../catalog/form-kit";

type TypeItem = { id: string; product_id: string; product_name: string; product_active: boolean; par: number; category: string; product_type: string; sort_order: number; active: boolean; revision: number };
type DisplayType = { id: string; code: string; name: string; family: string; sort_order: number; active: boolean; revision: number; store_count: number; items: TypeItem[] | null };
type Types = { can_manage: boolean; types: DisplayType[] };
type Product = { product_id: string; name: string; category: string; container_type: string };

const FAMILIES = ["Fruit", "Vegetables", "Salads", "Other"].map((f) => ({ value: f, label: f }));
const button = "min-h-10 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-50";
/** Suggested code from the name: lowercase words joined by underscores. */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 40);

/**
 * Organization admins define display case types (Feature 16): each type's products, default PAR,
 * category and order. Stores choose their types; changes reach every store using the type, except
 * PAR a store manager has overridden.
 */
export function DisplayTypesManager({ organizationId }: { organizationId: string }) {
  const [types, setTypes] = useState<DisplayType[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [reload, setReload] = useState(0);
  const path = `/display-types?organization_id=${organizationId}`;

  useEffect(() => {
    let live = true;
    async function load() {
      const result = await apiRequest<Types>(path, { method: "GET" });
      const catalog: Product[] = [];
      let cursor: string | null = null;
      do {
        const query: URLSearchParams = new URLSearchParams({ organization_id: organizationId, limit: "100", status: "active", ...(cursor ? { cursor } : {}) });
        const page = await apiRequest<{ items: Product[]; next_cursor: string | null }>(`/products?${query}`, { method: "GET" });
        if (!page.ok) break;
        catalog.push(...page.data.items);
        cursor = page.data.next_cursor;
      } while (cursor && live);
      if (!live) return;
      if (result.ok) setTypes(result.data.types);
      setFailure(result.ok ? null : result.failure);
      setProducts(catalog.sort((a, b) => a.name.localeCompare(b.name)));
    }
    void load();
    return () => { live = false; };
  }, [path, organizationId, reload]);

  const saved = (next: Types) => setTypes(next.types);
  if (failure) return <FailureNotice failure={failure} what="display case types" />;
  if (!types) return <p role="status">Loading display case types…</p>;
  return (
    <div className="flex flex-col gap-6">
      <NewTypeForm path={path} nextOrder={Math.max(0, ...types.map((t) => t.sort_order)) + 10} onSaved={saved} />
      {types.map((t) => <TypeCard key={`${t.id}:${t.revision}`} type={t} path={path} products={products} onSaved={saved} onReload={() => setReload((r) => r + 1)} />)}
    </div>
  );
}

function NewTypeForm({ path, nextOrder, onSaved }: { path: string; nextOrder: number; onSaved: (t: Types) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [family, setFamily] = useState("Other");
  const { busy, failure, run } = useMutation();
  return (
    <form className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5" onSubmit={async (e) => {
      e.preventDefault();
      const result = await run<Types>(path, "POST", { action: "save_type", code: code || slug(name), name, family, sort_order: Math.min(999, nextOrder), active: true });
      if (!result) return;
      setName(""); setCode(""); setFamily("Other");
      onSaved(result);
    }}>
      <h2 className="text-lg font-semibold">Add a display case type</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Name" value={name} onChange={setName} required maxLength={80} errors={errorsFor(failure, "name")} hint="As staff see it, e.g. “Cold Case”." />
        <TextField label="Code" value={code || slug(name)} onChange={setCode} required maxLength={40} errors={errorsFor(failure, "code")} hint="Permanent ID; lowercase and underscores." />
        <SelectField label="Family" value={family} onChange={setFamily} options={FAMILIES} errors={errorsFor(failure, "family")} hint="Groups waste reports." />
      </div>
      <FailureNotice failure={failure} what="the display case type" />
      <div><SubmitButton busy={busy} busyLabel="Adding…">Add type</SubmitButton></div>
    </form>
  );
}

function TypeCard({ type, path, products, onSaved, onReload }: { type: DisplayType; path: string; products: Product[]; onSaved: (t: Types) => void; onReload: () => void }) {
  const [editing, setEditing] = useState<"type" | "new" | string | null>(null);
  const [fields, setFields] = useState({ name: type.name, family: type.family, sort_order: String(type.sort_order) });
  const { busy, failure, run } = useMutation();
  const items = [...(type.items ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.product_name.localeCompare(b.product_name));
  async function saveType(change: Partial<{ active: boolean }> = {}) {
    const result = await run<Types>(path, "POST", {
      action: "save_type", id: type.id, expected_revision: type.revision, name: fields.name, family: fields.family,
      sort_order: Number(fields.sort_order), active: change.active ?? type.active,
    });
    if (result) { setEditing(null); onSaved(result); }
  }
  async function move(item: TypeItem, direction: "up" | "down") {
    const result = await run<Types>(path, "POST", { action: "move_item", display_type_id: type.id, id: item.id, direction, expected_revision: item.revision });
    if (result) onSaved(result);
  }
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5" aria-labelledby={`type-${type.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`type-${type.id}`} className="flex flex-wrap items-center gap-2 text-lg font-semibold">{type.name}{!type.active && <ArchivedBadge />}</h2>
          <p className="text-sm text-muted-foreground"><code>{type.code}</code> · {type.family} · order {type.sort_order} · used by {type.store_count} {type.store_count === 1 ? "store" : "stores"} · {items.length} {items.length === 1 ? "product" : "products"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setEditing("type")} disabled={editing !== null} subject={type.name}>Edit</SecondaryButton>
          <SecondaryButton onClick={() => {
            if (type.active && !window.confirm(`Archive ${type.name}? It disappears from every store's Stock Check; history is kept.`)) return;
            void saveType({ active: !type.active });
          }} disabled={busy || editing !== null} subject={type.name} tone={type.active ? "destructive" : "neutral"}>{type.active ? "Archive" : "Restore"}</SecondaryButton>
        </div>
      </div>
      {editing === "type" && (
        <form className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void saveType(); }}>
          <TextField label="Name" value={fields.name} onChange={(name) => setFields({ ...fields, name })} required maxLength={80} errors={errorsFor(failure, "name")} />
          <SelectField label="Family" value={fields.family} onChange={(family) => setFields({ ...fields, family })} options={FAMILIES} />
          <TextField label="Order" value={fields.sort_order} onChange={(sort_order) => setFields({ ...fields, sort_order })} inputMode="numeric" required errors={errorsFor(failure, "sort_order")} hint="Lower numbers come first in Stock Check." />
          <div className="flex gap-2 sm:col-span-3"><SubmitButton busy={busy} busyLabel="Saving…">Save type</SubmitButton><SecondaryButton onClick={() => setEditing(null)}>Cancel</SecondaryButton></div>
        </form>
      )}
      <FailureNotice failure={failure} what="the display case type" />
      {failure?.kind === "conflict" && <button type="button" className={`${button} self-start`} onClick={onReload}>Reload latest</button>}

      <ul className="divide-y divide-border border-t border-border">
        {items.length === 0 && <li className="py-3 text-sm text-muted-foreground">No products yet. Stores using this type have nothing to count in it.</li>}
        {items.map((item, index) => (
          <li key={item.id} className="py-3">
            {editing === item.id ? (
              <ItemForm typeId={type.id} path={path} products={products} item={item} onSaved={(t) => { setEditing(null); onSaved(t); }} onCancel={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{item.product_name}{!item.active ? " · Inactive" : ""}{!item.product_active ? " · Product archived" : ""}</p>
                  <p className="text-sm text-muted-foreground">{[item.category, item.product_type].filter(Boolean).join(" · ") || "Uncategorized"} · order {item.sort_order}</p>
                </div>
                <div className="text-right"><span className="block text-xs text-muted-foreground">Default PAR</span><span className="text-xl font-semibold tabular-nums">{item.par}</span></div>
                <div className="flex gap-1">
                  <button type="button" className={button} aria-label={`Move ${item.product_name} up`} title="Move up"
                    disabled={busy || editing !== null || index === 0} onClick={() => void move(item, "up")}>↑</button>
                  <button type="button" className={button} aria-label={`Move ${item.product_name} down`} title="Move down"
                    disabled={busy || editing !== null || index === items.length - 1} onClick={() => void move(item, "down")}>↓</button>
                </div>
                <SecondaryButton onClick={() => setEditing(item.id)} disabled={editing !== null} subject={item.product_name}>Edit</SecondaryButton>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? (
        <ItemForm typeId={type.id} path={path} products={products.filter((p) => !items.some((i) => i.product_id === p.product_id))} nextOrder={(items.at(-1)?.sort_order ?? -1) + 1} onSaved={(t) => { setEditing(null); onSaved(t); }} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" className={`${button} self-start`} disabled={editing !== null || !type.active} onClick={() => setEditing("new")}>Add product</button>
      )}
    </section>
  );
}

function ItemForm({ typeId, path, products, item, nextOrder = 0, onSaved, onCancel }: {
  typeId: string; path: string; products: Product[]; item?: TypeItem; nextOrder?: number; onSaved: (t: Types) => void; onCancel: () => void;
}) {
  const [v, setV] = useState({
    product_id: item?.product_id ?? "", par: item ? String(item.par) : "", category: item?.category ?? "", product_type: item?.product_type ?? "",
    sort_order: String(item?.sort_order ?? nextOrder), active: item?.active ?? true,
  });
  const { busy, failure, run } = useMutation();
  return (
    <form className="flex flex-col gap-4 rounded-lg bg-muted p-4" onSubmit={async (e) => {
      e.preventDefault();
      const result = await run<Types>(path, "POST", {
        action: "save_item", display_type_id: typeId, ...(item ? { id: item.id, expected_revision: item.revision } : {}), product_id: v.product_id,
        par: Number(v.par), category: v.category, product_type: v.product_type, sort_order: Number(v.sort_order), active: v.active,
      });
      if (result) onSaved(result);
    }}>
      <h3 className="font-semibold">{item ? `Edit ${item.product_name}` : "Add product"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {item ? <p className="text-sm"><span className="block font-medium">Product</span>{item.product_name}</p> : (
          <SelectField label="Product" value={v.product_id} errors={errorsFor(failure, "product_id")} onChange={(product_id) => {
            const p = products.find((x) => x.product_id === product_id);
            setV({ ...v, product_id, category: v.category || p?.category || "", product_type: v.product_type || p?.container_type || "" });
          }} options={[{ value: "", label: "Choose a catalog product…" }, ...products.map((p) => ({ value: p.product_id, label: p.name }))]} />
        )}
        <TextField label="Default PAR" value={v.par} onChange={(par) => setV({ ...v, par })} inputMode="numeric" required errors={errorsFor(failure, "par")} hint="Sellable containers. Stores may override." />
        <TextField label="Category" value={v.category} onChange={(category) => setV({ ...v, category })} maxLength={100} hint="Heading in Stock Check, e.g. “$5 bowls”." />
        <TextField label="Product type" value={v.product_type} onChange={(product_type) => setV({ ...v, product_type })} maxLength={100} />
        <TextField label="Order" value={v.sort_order} onChange={(sort_order) => setV({ ...v, sort_order })} inputMode="numeric" required errors={errorsFor(failure, "sort_order")} />
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Counted in this display case</label>
      </div>
      <FailureNotice failure={failure} what="the product" />
      <div className="flex gap-2"><SubmitButton busy={busy} busyLabel="Saving…">{item ? "Save product" : "Add product"}</SubmitButton><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton></div>
    </form>
  );
}
