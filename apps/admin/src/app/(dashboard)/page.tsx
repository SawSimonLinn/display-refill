import { CircleCheck, CircleDashed } from "lucide-react";

const STATUS = [
  { label: "API health endpoint", detail: "GET /api/v1/health", done: true },
  { label: "Server configuration validation", detail: "Reports missing variables by name", done: true },
  { label: "Database schema and RLS", detail: "Local Supabase migrations (feature 02); not yet used by the API", done: true },
  { label: "Supabase Auth sign-in", detail: "Feature 03", done: false },
  { label: "Vision analysis", detail: "Mock adapter only (feature 09)", done: false },
] as const;

export default function OverviewPage() {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Foundation status for this environment.</p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {STATUS.map(({ label, detail, done }) => (
          <li key={label} className="flex items-center gap-3 p-4">
            {done ? (
              <CircleCheck aria-hidden className="size-5 text-success" />
            ) : (
              <CircleDashed aria-hidden className="size-5 text-muted-foreground" />
            )}
            <div className="flex flex-1 flex-col">
              <span className="font-medium">{label}</span>
              <span className="text-sm text-muted-foreground">{detail}</span>
            </div>
            <span className="text-sm font-medium">{done ? "Available" : "Not started"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
