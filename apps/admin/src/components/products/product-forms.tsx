"use client";

import type { Product } from "@display-refill/domain";
import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArchivedBadge } from "../catalog/list-parts";
import { errorsFor, FailureNotice, SecondaryButton, SubmitButton, TextField, useEdits, useMutation } from "../catalog/form-kit";

type Fields = { name: string; short_name: string; category: string; container_type: string; sku: string; plu: string; upc: string };
const CODES = ["sku", "plu", "upc"] as const;

const fieldsOf = (p?: Product): Fields => ({
  name: p?.name ?? "",
  short_name: p?.short_name ?? "",
  category: p?.category ?? "",
  container_type: p?.container_type ?? "",
  sku: p?.sku ?? "",
  plu: p?.plu ?? "",
  upc: p?.upc ?? "",
});

/** Blank optional codes are sent as null (cleared), never as empty strings. */
const payloadOf = (f: Partial<Fields>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, (CODES as readonly string[]).includes(k) && v.trim() === "" ? null : v]));

function ProductFields({ value, onChange, failure }: { value: Fields; onChange: (next: Fields) => void; failure: ReturnType<typeof useMutation>["failure"] }) {
  const set = (key: keyof Fields) => (v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <TextField label="Name" value={value.name} onChange={set("name")} required maxLength={200} errors={errorsFor(failure, "name")} />
      <TextField label="Short name" value={value.short_name} onChange={set("short_name")} required maxLength={60} errors={errorsFor(failure, "short_name")} hint="Shown on refill lists." />
      <TextField label="Category" value={value.category} onChange={set("category")} required maxLength={100} errors={errorsFor(failure, "category")} />
      <TextField label="Container type" value={value.container_type} onChange={set("container_type")} required maxLength={100} errors={errorsFor(failure, "container_type")} hint="e.g. clamshell, bowl, cup." />
      <TextField label="SKU" value={value.sku} onChange={set("sku")} maxLength={64} errors={errorsFor(failure, "sku")} />
      <TextField label="PLU" value={value.plu} onChange={set("plu")} maxLength={64} errors={errorsFor(failure, "plu")} />
      <TextField label="UPC" value={value.upc} onChange={set("upc")} maxLength={14} inputMode="numeric" errors={errorsFor(failure, "upc")} hint="6–14 digits." />
    </div>
  );
}

export function CreateProductForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [fields, setFields] = useState(fieldsOf());
  const [created, setCreated] = useState<string | null>(null);
  const { busy, failure, run } = useMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreated(null);
    const product = await run<Product>("/products", "POST", { organization_id: organizationId, ...payloadOf(fields) });
    if (!product) return;
    setFields(fieldsOf());
    setCreated(`${product.name} was added.`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5" aria-label="Add a product">
      <h2 className="text-lg font-semibold">Add a product</h2>
      <ProductFields value={fields} onChange={setFields} failure={failure} />
      <FailureNotice failure={failure} what="product" />
      {created ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <CircleCheck aria-hidden className="size-4 text-success" />
          {created}
        </p>
      ) : null}
      <SubmitButton busy={busy} busyLabel="Adding…">
        Add product
      </SubmitButton>
    </form>
  );
}

export function ProductRow({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const edits = useEdits<Fields>(fieldsOf(product));
  const { busy, failure, run, clear } = useMutation();

  async function save(change: Record<string, unknown>) {
    if (Object.keys(change).length === 0) {
      setEditing(false);
      return;
    }
    const updated = await run<Product>(`/products/${product.product_id}`, "PATCH", { expected_revision: product.revision, ...change });
    if (!updated) return;
    setEditing(false);
    edits.reset();
    router.refresh();
  }

  const codes = CODES.filter((k) => product[k]).map((k) => `${k.toUpperCase()} ${product[k]}`);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {product.name}
            <span className="text-sm font-normal text-muted-foreground">({product.short_name})</span>
            {product.active ? null : <ArchivedBadge label="Archived · not usable in new layouts" />}
          </span>
          <span className="text-sm text-muted-foreground">
            {product.category} · {product.container_type}
            {codes.length ? ` · ${codes.join(" · ")}` : ""}
          </span>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {product.active ? (
              <SecondaryButton
                subject={product.name}
                onClick={() => {
                  clear();
                  edits.reset();
                  setEditing(!editing);
                }}
                disabled={busy}
              >
                {editing ? "Cancel" : "Edit"}
              </SecondaryButton>
            ) : null}
            <SecondaryButton
              subject={product.name}
              tone={product.active ? "destructive" : "neutral"}
              disabled={busy}
              onClick={() => {
                if (product.active && !window.confirm(`Archive ${product.name}? It stays in existing layouts and scan history but cannot be published in new layouts.`)) return;
                void save({ active: !product.active });
              }}
            >
              {product.active ? "Archive" : "Restore"}
            </SecondaryButton>
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          aria-label={`Edit ${product.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(payloadOf(edits.changes));
          }}
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <ProductFields value={edits.value} onChange={edits.onChange} failure={failure} />
          <p className="text-sm text-muted-foreground">Renaming does not change product names recorded in earlier scans.</p>
          <SubmitButton busy={busy} busyLabel="Saving…">
            Save changes
          </SubmitButton>
        </form>
      ) : null}
      <FailureNotice failure={failure} what="product" />
    </li>
  );
}
