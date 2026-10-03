import { listStores } from "@display-refill/server";
import type { Metadata } from "next";
import { EmptyState, LoadFailed, NextPageLink, PageHeader, PermissionNote, StatusFilter, statusParam, stringParam } from "@/components/catalog/list-parts";
import { CreateStoreForm, StoreRow } from "@/components/stores/store-forms";
import { sessionCaller, timeZoneNames } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Stores" };

/**
 * Admins create, edit and archive stores in their organization. Managers see
 * the stores assigned to them (read-only). Data comes from the same
 * RLS-scoped reads as GET /api/v1/stores; changes go through the API.
 */
export default async function StoresPage(props: PageProps<"/stores">) {
  const session = await requireDashboard("/stores");
  const { me } = session;
  const params = await props.searchParams;
  const status = statusParam(params.status);
  const cursor = stringParam(params.cursor);
  const adminOrgs = me.organizations.filter((o) => o.role === "admin");
  const result = await listStores(sessionCaller(session), me, { status, cursor, limit: 50 });

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Stores" description="Each store has a name, a unique store number and the time zone its scans are shown in.">
        <StatusFilter path="/stores" current={status} />
      </PageHeader>
      {adminOrgs.length > 0 ? (
        <CreateStoreForm organizations={adminOrgs.map(({ organization_id, name }) => ({ organization_id, name }))} />
      ) : (
        <PermissionNote>Only organization admins can add, edit or archive stores. Ask an admin if a store is missing.</PermissionNote>
      )}
      <datalist id="iana-time-zones">
        {timeZoneNames().map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
      {!result.ok ? (
        <LoadFailed what="Stores" />
      ) : result.value.items.length === 0 ? (
        status !== "active" ? (
          <EmptyState title={status === "archived" ? "No archived stores" : "No stores"}>Stores you archive appear here and can be restored.</EmptyState>
        ) : adminOrgs.length > 0 ? (
          <EmptyState title="No stores yet">Create the first store with the “Add a store” form above. You can then add displays to it and assign managers on the Members page.</EmptyState>
        ) : (
          <EmptyState title="No stores assigned to you">Ask an organization admin to make you a manager of a store.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            {status === "active" ? "Active stores" : status === "archived" ? "Archived stores" : "All stores"} ({result.value.items.length}
            {result.value.next_cursor ? "+" : ""})
          </h2>
          <ul className="flex flex-col gap-3">
            {result.value.items.map((store) => (
              <StoreRow key={store.store_id} store={store} canEdit={me.capabilities.admin_organization_ids.includes(store.organization_id)} />
            ))}
          </ul>
          <NextPageLink path="/stores" params={status === "active" ? {} : { status }} cursor={result.value.next_cursor} />
        </div>
      )}
    </section>
  );
}
