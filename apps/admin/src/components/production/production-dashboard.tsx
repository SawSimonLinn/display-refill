"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiRequest, type ApiFailure } from "@/lib/api-client";
import { useEdits, useMutation } from "@/components/catalog/form-kit";

const sections = ["fruit_mobile", "salad_mobile", "fruit_case", "veggie_case"] as const;
type Section = typeof sections[number];
const labels: Record<Section, string> = { fruit_mobile: "Fruit mobile bunker", salad_mobile: "Salad mobile", fruit_case: "Fruit display case", veggie_case: "Veggie display case" };
type Store = { store_id: string; organization_id: string; name: string; store_number: string; timezone: string };
type Product = { product_id: string; name: string; category: string; container_type: string };
type Item = { id: string; product_id: string; product_name: string; section: Section; category: string; product_type: string; par?: number; active: boolean; sort_order: number; revision: number; updated_at: string; updated_by: string };
type Config = { can_manage: boolean; items: Item[] };
type DayItem = { id: string; product_id: string; product_name: string; category: string; product_type: string; have: number; make: number | null };
type Day = { date: string; complete: boolean; total_make: number; sections: { section: Section; check_id: string | null; finished_at: string | null; total_make: number | null; in_progress?: boolean; items: DayItem[] }[] };
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
  const [day, setDay] = useState<Day | null>(null);
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
      const results = await Promise.all([apiRequest<Config>(`${base}?view=config`, { method: "GET" }), apiRequest<Day>(`${base}?view=day`, { method: "GET" }), apiRequest<{ events: EditEvent[] }>(`${base}?view=events`, { method: "GET" })]);
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
      const [c, d, e] = results;
      if (c.ok) setConfig(c.data);
      if (d.ok) setDay(d.data);
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
      {([["day", "Need to make now"], ["config", "PAR setup"], ["events", "Edit history"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} disabled={editing !== null} onClick={() => setTab(value)} className={`${button} ${tab === value ? "bg-foreground text-background" : "bg-card"}`}>{label}</button>)}
      <button type="button" className={button} disabled={loading || editing !== null} onClick={refresh}>Refresh</button>
    </div>
    {loading && <p role="status">Loading current production records…</p>}
    {failure && <ErrorMessage failure={failure} />}
    {tab === "day" && day && <MakeList day={day} zone={store.timezone} />}
    {tab === "config" && config && <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4"><h2 className="text-lg font-semibold">Store stocking targets</h2><p className="mt-1 text-sm text-muted-foreground">PAR is hidden from employees. Changes apply to new checks; checks already started keep their original targets. Products can appear in multiple sections. Shared backup is entered once in the first section; MAKE is combined across their latest checks.</p></div>
      {!config.can_manage ? <p>You do not have permission to change PAR for this store.</p> : <>
        <button type="button" className={`${button} self-start bg-success text-primary-foreground`} disabled={editing !== null} onClick={() => setEditing("new")}>Add worksheet product</button>
        {editing === "new" && <ItemForm products={products} base={base} onSaved={(c) => { setConfig(c); setEditing(null); refresh(); }} onCancel={() => setEditing(null)} onReload={refresh} />}
      </>}
      {editing && editing !== "new" && config.items.find((i) => i.id === editing) && <ItemForm key={editing} item={config.items.find((i) => i.id === editing)} products={products} base={base} onSaved={(c) => { setConfig(c); setEditing(null); refresh(); }} onCancel={() => setEditing(null)} onReload={refresh} />}
      {sections.map((section, index) => <section key={section} className="min-w-0 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold"><span className="mr-2 text-muted-foreground">0{index + 1}</span>{labels[section]}</h2>
        {!config.items.some((i) => i.section === section) && <p className="text-sm text-muted-foreground">No products configured. Add approved products and PAR quantities to enable this section.</p>}
        <ul className="divide-y divide-border">{config.items.filter((i) => i.section === section).sort((a, b) => a.sort_order - b.sort_order).map((item) => <li key={item.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{item.product_name}{!item.active ? " · Inactive" : ""}</h3><p className="text-sm text-muted-foreground">{[item.category, item.product_type].filter(Boolean).join(" · ") || "Uncategorized"}</p><p className="mt-1 text-xs text-muted-foreground">Updated {time(item.updated_at, store.timezone)} · revision {item.revision}</p></div><div className="text-right"><span className="block text-xs text-muted-foreground">PAR</span><span className="text-xl font-semibold tabular-nums">{item.par ?? "—"}</span></div>{config.can_manage && <button type="button" className={button} aria-label={`Edit ${item.product_name}`} disabled={editing !== null} onClick={() => setEditing(item.id)}>Edit</button>}</div>
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

function ItemForm({ item, products, base, onSaved, onCancel, onReload }: { item?: Item; products: Product[]; base: string; onSaved: (c: Config) => void; onCancel: () => void; onReload: () => void }) {
  const initial = { product_id: item?.product_id ?? "", section: item?.section ?? "fruit_mobile", par: item?.par?.toString() ?? "", category: item?.category ?? "", product_type: item?.product_type ?? "", sort_order: String(item?.sort_order ?? 0), active: String(item?.active ?? true) };
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
      <label className="min-w-0 text-sm font-medium">Display section<select className={field} value={value.section} onChange={(e) => change("section", e.target.value)}>{sections.map((s) => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
      <label className="text-sm font-medium">PAR · sellable packages<input className={field} required type="number" min="0" max="9999" step="1" value={value.par} onChange={(e) => change("par", e.target.value)} /></label>
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

function MakeList({ day, zone }: { day: Day; zone: string }) {
  const [section, setSection] = useState(""); const [category, setCategory] = useState(""); const [type, setType] = useState(""); const [sort, setSort] = useState("quantity");
  const all = day.sections.flatMap((s) => s.items.map((item) => ({ ...item, section: s.section })));
  const shown = all.filter((i) => (i.make ?? 0) > 0 && (!section || i.section === section) && (!category || i.category === category) && (!type || i.product_type === type)).sort((a, b) => sort === "quantity" ? (b.make ?? 0) - (a.make ?? 0) || a.product_name.localeCompare(b.product_name) : a.product_name.localeCompare(b.product_name));
  return <section className="flex min-w-0 flex-col gap-5">
    <div className="rounded-lg border border-border bg-card p-5"><p className="text-sm font-medium text-muted-foreground">NEED TO MAKE NOW · {day.date}</p><p className="mt-2 text-4xl font-semibold tabular-nums">{day.total_make} <span className="text-base font-normal">packages</span></p><p className="mt-2 text-sm">{day.complete ? "All four sections checked." : "Partial total — some sections are not finished today."} Latest finished check per section; shared backup deducted once. Not cumulative daily production. Shared products wait for all their sections.</p></div>
    <ol className="divide-y divide-border rounded-lg border border-border bg-card px-4">{sections.map((key) => { const s = day.sections.find((s) => s.section === key); return <li key={key} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="font-medium">{labels[key]}</span><span className="text-muted-foreground">{s?.finished_at ? `${time(s.finished_at, zone)} · Make ${s.total_make ?? "pending shared counts"}` : "Not finished today · excluded from total"}{s?.in_progress ? " · New check in progress (not included)" : ""}</span></li>; })}</ol>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="min-w-0 text-sm">Section<select aria-label="Section" className={field} value={section} onChange={(e) => setSection(e.target.value)}><option value="">All sections</option>{sections.map((s) => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
      <label className="min-w-0 text-sm">Category<select aria-label="Category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(all.map((i) => i.category).filter(Boolean))].sort().map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="min-w-0 text-sm">Product type<select aria-label="Product type" className={field} value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{[...new Set(all.map((i) => i.product_type).filter(Boolean))].sort().map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="min-w-0 text-sm">Order<select aria-label="Order" className={field} value={sort} onChange={(e) => setSort(e.target.value)}><option value="quantity">Highest MAKE first</option><option value="name">Product name</option></select></label>
    </div>
    <p role="status" className="text-sm">Showing {shown.length} products · {shown.reduce((sum, i) => sum + (i.make ?? 0), 0)} packages match these filters</p>
    {shown.length === 0 ? <p className="rounded-lg border border-border p-5">No make quantities match. Unfinished sections are not counted as zero.</p> : <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">{shown.map((i) => <li key={`${i.section}-${i.id}`} className="flex min-w-0 items-start justify-between gap-4 py-4"><div className="min-w-0"><h3 className="break-words font-medium">{i.product_name}</h3><p className="text-sm text-muted-foreground">{labels[i.section]} · HAVE {i.have}</p><p className="text-xs text-muted-foreground">{[i.category, i.product_type].filter(Boolean).join(" · ")}</p></div><div className="shrink-0 text-right"><span className="block text-xs text-muted-foreground">MAKE</span><strong className="text-2xl tabular-nums">{i.make}</strong></div></li>)}</ul>}
  </section>;
}
