import { listDisplays, listPogs, storeAccess } from "@display-refill/server";
import type { Metadata } from "next";
import { EmptyState, LoadFailed, NextPageLink, PageHeader, PermissionNote, StatusFilter, statusParam, stringParam } from "@/components/catalog/list-parts";
import { CreateDisplayForm, DisplayRow, type VersionOption } from "@/components/displays/display-forms";
import { sessionCaller } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Displays" };

/**
 * Displays of one store. Managers of that store and organization admins add,
 * rename, archive displays and assign published POG versions; the API checks
 * the store from the stored display on every change.
 */
export default async function DisplaysPage(props: PageProps<"/displays">) {
  const session = await requireDashboard("/displays");
  const { me } = session;
  const params = await props.searchParams;
  const status = statusParam(params.status);
  const requested = stringParam(params.store_id);
  const managed = me.stores.filter((s) => s.role !== "employee");
  const storeId = requested ?? managed[0]?.store_id ?? me.stores[0]?.store_id;

  if (!storeId) {
    return (
      <section className="flex flex-col gap-6">
        <PageHeader title="Displays" description="Display cases in a store and the POG version each one uses." />
        <EmptyState title="No stores available">
          {me.capabilities.admin_organization_ids.length > 0 ? "Create a store on the Stores page first, then add its displays here." : "Ask an organization admin to make you a manager of a store."}
        </EmptyState>
      </section>
    );
  }

  const caller = sessionCaller(session);
  const store = await storeAccess(caller, me, storeId);
  if (!store.ok) {
    return (
      <section className="flex flex-col gap-6">
        <PageHeader title="Displays" description="Display cases in a store and the POG version each one uses." />
        {store.code === "NOT_FOUND" ? (
          <EmptyState title="Store not found">This store does not exist or is not assigned to you. Choose one of your stores in the Store menu.</EmptyState>
        ) : (
          <LoadFailed what="The store" />
        )}
      </section>
    );
  }
  const canEdit = store.value.access !== "employee";
  const [displays, pogs] = await Promise.all([
    listDisplays(caller, me, storeId, { status: canEdit ? status : "active", cursor: stringParam(params.cursor), limit: 50 }),
    canEdit ? listPogs(caller, me, { status: "active", limit: 100, organization_id: store.value.organization_id }) : null,
  ]);
  const versions: VersionOption[] =
    pogs?.ok
      ? pogs.value.items.flatMap((p) => p.versions.filter((v) => v.state === "published").map((v) => ({ pog_version_id: v.pog_version_id, label: `${p.name} · v${v.version_number}` })))
      : [];
  const timezone = me.stores.find((s) => s.store_id === storeId)?.timezone ?? "UTC";
  const keep = { store_id: storeId };

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={`Displays — ${store.value.name}`}
        description={`Store #${store.value.store_number}. Each display uses one published POG version; scans pin the version assigned when they start.`}
      >
        {canEdit ? <StatusFilter path="/displays" current={status} params={keep} /> : null}
      </PageHeader>
      {!store.value.active ? (
        <PermissionNote>This store is archived. Its displays cannot be scanned or added to until an admin restores the store.</PermissionNote>
      ) : canEdit ? (
        <CreateDisplayForm storeId={storeId} storeName={store.value.name} versions={versions} />
      ) : (
        <PermissionNote>Only managers of this store and organization admins can change its displays.</PermissionNote>
      )}
      {!displays.ok ? (
        <LoadFailed what="Displays" />
      ) : displays.value.items.length === 0 ? (
        status !== "active" ? (
          <EmptyState title={status === "archived" ? "No archived displays" : "No displays"}>Displays you archive appear here and can be restored.</EmptyState>
        ) : canEdit && store.value.active ? (
          <EmptyState title={`No displays in ${store.value.name} yet`}>
            Add the first display with the form above.{versions.length === 0 ? " No POG version is published yet; you can assign one once an admin publishes a layout." : ""}
          </EmptyState>
        ) : (
          <EmptyState title="No displays yet">A manager of this store adds its displays.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            {status === "active" ? "Active displays" : status === "archived" ? "Archived displays" : "All displays"} ({displays.value.items.length}
            {displays.value.next_cursor ? "+" : ""})
          </h2>
          <ul className="flex flex-col gap-3">
            {displays.value.items.map((display) => (
              <DisplayRow key={display.display_id} display={display} canEdit={canEdit} versions={versions} timezone={timezone} />
            ))}
          </ul>
          <NextPageLink path="/displays" params={{ ...keep, ...(status === "active" ? {} : { status }) }} cursor={displays.value.next_cursor} />
        </div>
      )}
    </section>
  );
}
