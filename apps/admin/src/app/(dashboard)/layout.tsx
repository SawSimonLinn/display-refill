import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <nav aria-label="Main" className="flex flex-col gap-4 border-b border-border bg-card p-4 md:w-60 md:border-r md:border-b-0">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Display Refill
        </Link>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Store
          {/* Store filter is persistent for managers; populated once memberships exist (feature 03/04). */}
          <select disabled className="min-h-10 rounded-lg border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60">
            <option>No stores available</option>
          </select>
        </label>
        <NavLinks />
      </nav>
      <div className="flex flex-1 flex-col">
        <div role="status" className="flex items-center gap-2 border-b border-border bg-warning-surface px-4 py-2 text-sm text-foreground">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
          <span>
            Development shell. Sign-in is not implemented yet (feature 03); no pages are protected and no data is shown.{" "}
            <Link href="/sign-in" className="font-medium underline">
              Sign-in placeholder
            </Link>
          </span>
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
