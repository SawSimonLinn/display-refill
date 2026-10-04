import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth-card";
import { NavLinks } from "@/components/nav-links";
import { StoreFilter } from "@/components/store-filter";
import { isAdmin, requireDashboard } from "@/server/session";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // Pages repeat this check: layouts are not re-rendered on every client navigation.
  const { me, user } = await requireDashboard("/");
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <nav aria-label="Main" className="flex flex-col gap-4 border-b border-border bg-card p-4 md:w-60 md:border-r md:border-b-0">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Display Refill
        </Link>
        <Suspense>
          <StoreFilter stores={me.stores} defaultStoreId={(me.stores.find((st) => st.role !== "employee") ?? me.stores[0])?.store_id} />
        </Suspense>
        <NavLinks showMembers={isAdmin(me)} />
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4 text-sm">
          <span className="truncate text-muted-foreground" title={user.email ?? undefined}>
            {user.email}
          </span>
          <Link href="/account/password" className="font-medium underline">
            Change password
          </Link>
          <SignOutButton className="text-left font-medium underline" />
        </div>
      </nav>
      <div className="flex flex-1 flex-col">
        <div role="status" className="flex items-center gap-2 border-b border-border bg-warning-surface px-4 py-2 text-sm text-foreground">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
          <span>Development build. Photo analysis uses a synthetic test provider only; no real vision provider is configured.</span>
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
