"use client";

import type { MeStore } from "@display-refill/domain";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Store filter in the navigation (ui-context.md: always visible for
 * managers). Lists only stores the caller may access; choosing one opens its
 * displays. The pages and API authorize the store again.
 */
export function StoreFilter({ stores, defaultStoreId }: { stores: MeStore[]; defaultStoreId: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = (pathname === "/displays" ? params.get("store_id") : null) ?? defaultStoreId ?? "";
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      Store
      <select
        value={selected}
        disabled={stores.length === 0}
        onChange={(e) => router.push(`/displays?store_id=${encodeURIComponent(e.target.value)}`)}
        className="min-h-10 rounded-lg border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60"
      >
        {stores.length === 0 ? <option value="">No stores available</option> : null}
        {stores.map((s) => (
          <option key={s.store_id} value={s.store_id}>
            {s.name} · #{s.store_number}
          </option>
        ))}
      </select>
    </label>
  );
}
