"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PrepDashboard } from "./prep-dashboard";
import { apiRequest, type ApiFailure } from "@/lib/api-client";
import { useEdits, useMutation } from "@/components/catalog/form-kit";

/** Display case types of the organization; `selected` ones are this store's sections, in type order. */
type Section = { id: string; code: string; name: string; family: string; selected: boolean };
type Store = { store_id: string; organization_id: string; name: string; store_number: string; timezone: string };
type Product = { product_id: string; name: string; category: string; container_type: string };
type Item = { id: string; product_id: string; product_name: string; section: string; category: string; product_type: string; par?: number; active: boolean; sort_order: number; revision: number; updated_at: string; updated_by: string | null;
  from_display_type?: boolean; par_overridden?: boolean; default_par?: number | null };
type Config = { can_manage: boolean; sections: Section[]; items: Item[] };
type EditEvent = { id: string; kind: string; actor_id: string; actor_name: string; created_at: string; item_id: string | null; check_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
const field = "min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";
const button = "min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50";
const time = (value: string, zone: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: zone }).format(new Date(value));

function ErrorMessage({ failure }: { failure: ApiFailure }) {
  return <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
    <p>{failure.message}</p>
    {Object.entries(failure.fieldErrors).map(([name, messages]) => <p key={name}>{name}: {messages.join("; ")}</p>)}
    {failure.kind === "session" && <Link href="/sign-in?next=%2Fproduction" className="underline">Sign in again</Link>}
  </div>;
}

export function ProductionDashboard({ stores }: { stores: Store[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.store_id ?? "");
  const [editingLocked, setEditingLocked] = useState(false);
  const store = stores.find((s) => s.store_id === storeId);
  if (!store) return <p className="rounded-lg border border-border p-5">No managed stores are available. Ask an organization admin to assign a store.</p>;
  return <div className="flex min-w-0 flex-col gap-5">
    <label className="flex max-w-lg flex-col gap-2 text-sm font-medium">Store<select className={field} disabled={editingLocked} value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.store_id} value={s.store_id}>{s.name} · #{s.store_number}</option>)}</select></label>
    {editingLocked && <p className="text-sm text-muted-foreground">Save or cancel your PAR edit before changing stores or views.</p>}
    <StoreProduction key={storeId} store={store} onEditingChange={setEditingLocked} />
  </div>;
}

function StoreProduction({ store, onEditingChange }: { store: Store; onEditingChange: (locked: boolean) => void }) {
  const [tab, setTab] = useState<"day" | "config" | "events">("day");
  const [config, setConfig] = useState<Config | null>(null);
  const [events, setEvents] = useState<EditEvent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing]);
  const base = `/production/${store.store_id}`;
  useEffect(() => { onEditingChange(editing !== null); }, [editing, onEditingChange]);
  useEffect(() => {
    let live = true;
    async function load() {
      const results = await Promise.all([apiRequest<Config>(`${base}?view=config`, { method: "GET" }), apiRequest<{ events: EditEvent[] }>(`${base}?view=events`, { method: "GET" })]);
      const catalog: Product[] = [];
      let cursor: string | null = null;
      let catalogFailure: ApiFailure | null = null;
      do {
        const query: URLSearchParams = new URLSearchParams({ organization_id: store.organization_id, limit: "100", status: "active", ...(cursor ? { cursor } : {}) });
        const response = await apiRequest<{ items: Product[]; next_cursor: string | null }>(`/products?${query}`, { method: "GET" });
        if (!response.ok) { catalogFailure = response.failure; break; }
        catalog.push(...response.data.items);
        cursor = response.data.next_cursor;
      } while (cursor && live);
      if (!live) return;
      const [c, e] = results;
      if (c.ok) setConfig(c.data);
      if (e.ok) setEvents(e.data.events);
      setProducts(catalog);
      setFailure(results.find((r) => !r.ok)?.failure ?? catalogFailure);
      setLoading(false);
    }
    void load();
    return () => { live = false; };
  }, [base, store.organization_id, reload]);
  const refresh = () => { setLoading(true); setReload((r) => r + 1); };
  return <div className="flex min-w-0 flex-col gap-5">
    <div className="flex flex-wrap items-center gap-2" aria-label="Production views">
      {([["day", "Prep List"], ["config", "PAR setup"], ["events", "Edit history"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} disabled={editing !== null} onClick={() => setTab(value)} className={`${button} ${tab === value ? "bg-foreground text-background" : "bg-card"}`}>{label}</button>)}
      <button type="button" className={button} disabled={loading || editing !== null} onClick={refresh}>Refresh</button>
    </div>
    {loading && <p role="status">Loading current production records…</p>}
    {failure && <ErrorMessage failure={failure} />}
    {tab === "day" && <PrepDashboard storeId={store.store_id} zone={store.timezone} sectionNames={Object.fromEntries((config?.sections ?? []).map((s) => [s.code, s.name]))} />}
    {tab === "config" && config && <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4"><h2 className="text-lg font-semibold">Store stocking targets</h2><p className="mt-1 text-sm text-muted-foreground">PAR is hidden from employees. Changes apply to new checks; checks already started keep their original targets. Products can appear in multiple sections. Staff enter one HAVE count per display; To make shows the shortage for that section. The Prep List combines matching products.</p><p className="mt-2 text-sm text-muted-foreground">Products and default PAR come from the organization’s display case types. Changing PAR here overrides the default for this store only; set it back to the default to follow admin updates again.</p></div>
      {config.can_manage && <TypePicker base={`/stores/${store.store_id}/display-types`} sections={config.sections} disabled={editing !== null} onSaved={(c) => { setConfig(c); refresh(); }} />}
      {!config.can_manage ? <p>You do not have permission to change PAR for this store.</p> : <>
        <button type="button" className={`${button} self-start bg-success text-primary-foreground`} disabled={editing !== null} onClick={() => setEditing("new")}>Add worksheet product</button>
        {editing === "new" && <ItemForm sections={selectedSections(config)} products={products} base={base} onSaved={(c) => { setConfig(c); setEditing(null); refresh(); }} onCancel={() => setEditing(null)} onReload={refresh} />}
      </>}
      {editing && editing !== "new" && config.items.find((i) => i.id === editing) && <ItemForm key={editing} sections={selectedSections(config)} item={config.items.find((i) => i.id === editing)} products={products} base={base} onSaved={(c) => { setConfig(c); setEditing(null); refresh(); }} onCancel={() => setEditing(null)} onReload={refresh} />}
      {selectedSections(config).map((section, index) => <section key={section.code} className="min-w-0 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold"><span className="mr-2 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>{section.name}</h2>
        {!config.items.some((i) => i.section === section.code) && <p className="text-sm text-muted-foreground">No products configured. An admin adds products to this display case type, or add a product for this store only.</p>}
        <ul className="divide-y divide-border">{config.items.filter((i) => i.section === section.code).sort((a, b) => a.sort_order - b.sort_order).map((item) => <li key={item.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{item.product_name}{!item.active ? " · Inactive" : ""}</h3><p className="text-sm text-muted-foreground">{[item.category, item.product_type].filter(Boolean).join(" · ") || "Uncategorized"}{item.from_display_type ? "" : " · Added for this store"}</p><p className="mt-1 text-xs text-muted-foreground">Updated {time(item.updated_at, store.timezone)} · revision {item.revision}</p></div><div className="text-right"><span className="block text-xs text-muted-foreground">PAR</span><span className="text-xl font-semibold tabular-nums">{item.par ?? "—"}</span>{item.par_overridden && <span className="block text-xs text-warning">Store override · default {item.default_par}</span>}</div>{config.can_manage && <button type="button" className={button} aria-label={`Edit ${item.product_name}`} disabled={editing !== null} onClick={() => setEditing(item.id)}>Edit</button>}</div>
        </li>)}</ul>
      </section>)}
    </div>}
    {tab === "events" && !loading && <section><h2 className="text-lg font-semibold">Recent changes</h2><p className="mb-4 text-sm text-muted-foreground">Most recent 100 events · times in {store.timezone}. PAR updates, count edits, and finished checks.</p>{events.length === 0 ? <p>No recorded changes yet.</p> : <ol className="divide-y divide-border rounded-lg border border-border bg-card px-4">{events.map((event) => <li key={event.id} className="min-w-0 py-4"><h3 className="font-medium">{String(event.after?.product_name ?? config?.items.find((item) => item.id === event.item_id)?.product_name ?? "Section check")} · {event.kind.replaceAll("_", " ")}</h3><p className="text-sm">{event.actor_name || event.actor_id} · <time dateTime={event.created_at}>{time(event.created_at, store.timezone)}</time></p><EventDetails event={event} /><details className="mt-2 text-xs"><summary className="cursor-pointer">Record details</summary><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify({ item: event.item_id, check: event.check_id, before: event.before, after: event.after }, null, 2)}</pre></details></li>)}</ol>}</section>}
  </div>;
}

function EventDetails({ event }: { event: EditEvent }) {
  const keys = ["par", "have", "section", "status", "active", "category", "product_type"];
  return <ul className="mt-2 text-sm text-muted-foreground">{keys.filter((key) => event.before?.[key] !== event.after?.[key]).map((key) => <li key={key}>{key === "par" ? "PAR" : key === "have" ? "HAVE" : key.replaceAll("_", " ")}: {String(event.before?.[key] ?? "Not set")} → {String(event.after?.[key] ?? "Not set")}</li>)}</ul>;
}

const selectedSections = (config: Config) => config.sections.filter((s) => s.selected);

/** Store managers choose which display case types this store has. */
function TypePicker({ base, sections, disabled, onSaved }: { base: string; sections: Section[]; disabled: boolean; onSaved: (c: Config) => void }) {
  const current = sections.filter((s) => s.selected).map((s) => s.id);
  const [chosen, setChosen] = useState<string[]>(current);
  const mutation = useMutation();
  const changed = chosen.length !== current.length || chosen.some((id) => !current.includes(id));
  return <form className="rounded-lg border border-border bg-card p-4" onSubmit={async (e) => {
    e.preventDefault();
    const result = await mutation.run<Config>(base, "PUT", { display_type_ids: chosen });
    if (result) onSaved(result);
  }}>
    <fieldset disabled={disabled || mutation.busy} className="flex flex-col gap-3">
      <legend className="text-lg font-semibold">Display cases in this store</legend>
      <p className="text-sm text-muted-foreground">Staff count only the cases you choose. Removing one keeps its history; its products stop appearing in Stock Check and the Prep List.</p>
      <div className="grid gap-2 sm:grid-cols-2">{sections.map((s) => <label key={s.id} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
        <input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((id) => id !== s.id))} />{s.name}</label>)}</div>
      {mutation.failure && <ErrorMessage failure={mutation.failure} />}
      <div className="flex flex-wrap gap-2"><button type="submit" className={`${button} bg-success text-primary-foreground`} disabled={!changed || chosen.length === 0}>{mutation.busy ? "Saving…" : "Save display cases"}</button>{changed && <button type="button" className={button} onClick={() => setChosen(current)}>Undo changes</button>}</div>
    </fieldset>
  </form>;
}

function ItemForm({ item, sections, products, base, onSaved, onCancel, onReload }: { item?: Item; sections: Section[]; products: Product[]; base: string; onSaved: (c: Config) => void; onCancel: () => void; onReload: () => void }) {
  const initial = { product_id: item?.product_id ?? "", section: item?.section ?? sections[0]?.code ?? "", par: item?.par?.toString() ?? "", category: item?.category ?? "", product_type: item?.product_type ?? "", sort_order: String(item?.sort_order ?? 0), active: String(item?.active ?? true) };
  const edits = useEdits(initial);
  const value = edits.value;
  const mutation = useMutation();
  const busyRef = useRef(false);
  const [savedMessage, setSavedMessage] = useState("");
  const change = (name: keyof typeof initial, next: string) => edits.onChange({ ...value, [name]: next });
  return <form className="mt-4 flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-muted p-4" onSubmit={async (e) => {
    e.preventDefault(); if (busyRef.current) return; busyRef.current = true;
    const result = await mutation.run<Config>(base, "POST", { action: "configure", ...(item ? { item_id: item.id, expected_revision: item.revision } : {}), product_id: value.product_id, section: value.section, par: Number(value.par), category: value.category, product_type: value.product_type, sort_order: Number(value.sort_order), active: value.active === "true" });
    busyRef.current = false;
    if (result) { setSavedMessage("PAR configuration saved."); onSaved(result); }
  }}>
    <h3 className="font-semibold">{item ? `Edit ${item.product_name}` : "Add worksheet product"}</h3>
    <fieldset disabled={mutation.busy || mutation.failure?.kind === "network"} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">Product<select required disabled={Boolean(item)} className={field} value={value.product_id} onChange={(e) => { const p = products.find((p) => p.product_id === e.target.value); edits.onChange({ ...value, product_id: e.target.value, category: p?.category ?? "", product_type: p?.container_type ?? "" }); }}><option value="">Select a catalog product</option>{item && !products.some((p) => p.product_id === item.product_id) && <option value={item.product_id}>{item.product_name} (inactive catalog product)</option>}{products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}</select></label>
      <label className="min-w-0 text-sm font-medium">Display section<select className={field} disabled={item?.from_display_type} value={value.section} onChange={(e) => change("section", e.target.value)}>{item && !sections.some((s) => s.code === item.section) && <option value={item.section}>{item.section} (not used at this store)</option>}{sections.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
      <label className="text-sm font-medium">PAR · sellable packages<input className={field} required type="number" min="0" max="9999" step="1" value={value.par} onChange={(e) => change("par", e.target.value)} />
        {item?.from_display_type && item.default_par != null && <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">Default {item.default_par}{value.par !== String(item.default_par) && <button type="button" className="underline" onClick={() => change("par", String(item.default_par))}>Use default</button>}</span>}</label>
      <label className="text-sm font-medium">Order within section<input className={field} required type="number" min="0" max="999" step="1" value={value.sort_order} onChange={(e) => change("sort_order", e.target.value)} /></label>
      <label className="text-sm font-medium">Category<input className={field} maxLength={100} value={value.category} onChange={(e) => change("category", e.target.value)} /></label>
      <label className="text-sm font-medium">Product type<input className={field} maxLength={100} value={value.product_type} onChange={(e) => change("product_type", e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.active === "true"} onChange={(e) => change("active", String(e.target.checked))} />Active in new checks</label>
    </fieldset>
    {!item && products.length === 0 && <p className="text-sm">No available catalog products. An admin can add products in <Link href="/products" className="underline">Products</Link>.</p>}
    {mutation.failure && <ErrorMessage failure={mutation.failure} />}
    {mutation.failure?.kind === "network" && <p role="alert" className="text-sm">The save outcome is unknown. Retry without changing fields to reuse the same operation key and retrieve its outcome.</p>}
    {mutation.failure?.kind === "conflict" && <div className="text-sm"><p>Someone changed this item. Reload latest to merge untouched fields; your edited fields stay in place. Review before saving again.</p><button type="button" className={button} onClick={onReload}>Reload latest values</button></div>}
    <p role="status" className="text-sm">{savedMessage}</p>
    <div className="flex flex-wrap gap-2"><button type="submit" className={`${button} bg-success text-primary-foreground`} disabled={mutation.busy || !value.product_id}>{mutation.busy ? "Saving…" : mutation.failure?.kind === "network" ? "Retry save" : "Save PAR settings"}</button><button type="button" className={button} disabled={mutation.busy} onClick={() => { if (mutation.failure?.kind === "network" && !window.confirm("The last save may have succeeded. Discard this local retry? Refresh PAR setup afterward to check the saved values.")) return; onCancel(); }}>Cancel</button></div>
  </form>;
}
