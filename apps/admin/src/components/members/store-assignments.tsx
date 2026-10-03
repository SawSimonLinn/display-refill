"use client";

import type { Assignment, StoreOption } from "./members-api";

/** Checkbox per store plus its role. Produces the complete assignment set. */
export function StoreAssignments({ stores, value, onChange, disabled }: { stores: StoreOption[]; value: Assignment[]; onChange: (next: Assignment[]) => void; disabled?: boolean }) {
  if (stores.length === 0) return <p className="text-sm text-muted-foreground">This organization has no active stores yet.</p>;
  const roleOf = new Map(value.map((a) => [a.store_id, a.role]));
  const set = (storeId: string, role: Assignment["role"] | null) => {
    const rest = value.filter((a) => a.store_id !== storeId);
    onChange(role ? [...rest, { store_id: storeId, role }] : rest);
  };
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Stores</legend>
      {stores.map((s) => {
        const role = roleOf.get(s.store_id);
        return (
          <div key={s.store_id} className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-10 flex-1 items-center gap-2 text-sm">
              <input type="checkbox" checked={role !== undefined} onChange={(e) => set(s.store_id, e.target.checked ? "employee" : null)} className="size-4" />
              {s.name} <span className="text-muted-foreground">#{s.store_number}</span>
            </label>
            <select
              aria-label={`Role at ${s.name}`}
              value={role ?? "employee"}
              disabled={role === undefined}
              onChange={(e) => set(s.store_id, e.target.value as Assignment["role"])}
              className="min-h-10 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
            </select>
          </div>
        );
      })}
    </fieldset>
  );
}
