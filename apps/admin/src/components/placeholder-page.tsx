import { Construction } from "lucide-react";
import { requireDashboard } from "@/server/session";

/** Honest stand-in for screens that later features build. Shows no fake data. */
export async function PlaceholderPage({ path, title, feature, description }: { path: string; title: string; feature: string; description: string }) {
  await requireDashboard(path);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-5">
        <Construction aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Not built yet — {feature}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </section>
  );
}
