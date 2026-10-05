import { OperationsDashboard } from "@/components/production/operations-dashboard";
import { requireDashboard } from "@/server/session";
export default async function OverviewPage() {
 const { me } = await requireDashboard("/");
 return <section className="flex min-w-0 flex-col gap-6">
  <div><h1 className="text-2xl font-semibold tracking-tight">Made & Waste</h1><p className="text-muted-foreground">Daily, weekly and monthly recorded production and waste.</p></div>
  <OperationsDashboard stores={me.stores.filter(s=>s.role!=="employee")} />
 </section>;
}
