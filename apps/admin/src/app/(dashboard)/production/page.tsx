import type { Metadata } from "next";
import { PageHeader } from "@/components/catalog/list-parts";
import { ProductionDashboard } from "@/components/production/production-dashboard";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Production" };

export default async function ProductionPage() {
  const { me } = await requireDashboard("/production");
  return <section className="flex min-w-0 flex-col gap-6">
    <PageHeader title="Production" description="Four sections. One current make list. HAVE includes display stock and prepared backup stock, counted once." />
    <ProductionDashboard stores={me.stores.filter((store) => store.role !== "employee")} />
  </section>;
}
