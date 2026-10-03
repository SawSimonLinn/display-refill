import { CircleCheck, CircleDashed } from "lucide-react";
import { requireDashboard } from "@/server/session";

const STATUS = [
  { label: "API health endpoint", detail: "GET /api/v1/health", done: true },
  { label: "Database schema and RLS", detail: "Local Supabase migrations (feature 02)", done: true },
  { label: "Supabase Auth sign-in and memberships", detail: "Web sessions, iOS bearer tokens, admin invitations (feature 03)", done: true },
  { label: "Store, display and product management", detail: "Stores, products, POG identities, displays and assignment (feature 04)", done: true },
  { label: "POG builder and publication", detail: "Reference upload, slot editor, drafts and publishing (feature 05)", done: true },
  { label: "Scans and refill lists", detail: "Features 06–08", done: false },
  { label: "Vision analysis", detail: "Mock adapter only (feature 09)", done: false },
] as const;

const ROLE_LABEL = { admin: "Admin", manager: "Manager", employee: "Employee" } as const;

export default async function OverviewPage() {
  const { me } = await requireDashboard("/");
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          {me.organizations.map((o) => `${o.name} (${o.role === "admin" ? "admin" : "member"})`).join(", ")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your stores</h2>
        {me.stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active stores yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {me.stores.map((s) => (
              <li key={s.store_id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-muted-foreground">
                    Store #{s.store_number} · {s.timezone}
                  </span>
                </div>
                <span className="text-sm font-medium">{ROLE_LABEL[s.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Build status</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {STATUS.map(({ label, detail, done }) => (
            <li key={label} className="flex items-center gap-3 p-4">
              {done ? <CircleCheck aria-hidden className="size-5 text-success" /> : <CircleDashed aria-hidden className="size-5 text-muted-foreground" />}
              <div className="flex flex-1 flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{detail}</span>
              </div>
              <span className="text-sm font-medium">{done ? "Available" : "Not started"}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
