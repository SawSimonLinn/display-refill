"use client";

import { LayoutGrid, Package, Store, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/production", label: "Production", icon: Package },
  { href: "/stores", label: "Stores", icon: Store },
  { href: "/products", label: "Products", icon: Package },
  { href: "/display-types", label: "Display types", icon: LayoutGrid },
  { href: "/members", label: "Members", icon: Users },
] as const;

const ADMIN_ONLY: readonly string[] = ["/display-types", "/members"];

/** Display types and Members are shown to org admins only; the pages and API enforce it regardless. */
export function NavLinks({ showMembers }: { showMembers: boolean }) {
  const pathname = usePathname();
  const items = showMembers ? NAV_ITEMS : NAV_ITEMS.filter((item) => !ADMIN_ONLY.includes(item.href));
  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
              }`}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
