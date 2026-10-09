import { listPogs } from "@display-refill/server";
import type { Metadata } from "next";
import { EmptyState, LoadFailed, NextPageLink, PageHeader, PermissionNote, StatusFilter, statusParam, stringParam } from "@/components/catalog/list-parts";
import { CreatePogForm, type KindOption, PogRow } from "@/components/pogs/pog-forms";
import { pageServiceClient, sessionCaller } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "POGs" };

/**
 * Reusable POG identities. Admins create (with an empty draft version 1),
 * rename and archive them and open versions in the editor; managers see
 * published versions (read-only) for assignment.
 */
export default async function PogsPage(props: PageProps<"/pogs">) {
  const session = await requireDashboard("/pogs");
  const { me } = session;
  const params = await props.searchParams;
  const status = statusParam(params.status);
  const organizationId = stringParam(params.organization_id) ?? me.organizations[0]?.organization_id;
  const result = await listPogs(sessionCaller(session), me, { status, cursor: stringParam(params.cursor), limit: 50, organization_id: organizationId });
  const canEdit = organizationId !== undefined && me.capabilities.admin_organization_ids.includes(organizationId);
  const keep = { ...(organizationId && me.organizations.length > 1 ? { organization_id: organizationId } : {}) };
  // Display case types of the organization (membership checked inside display_types_read).
  const types = organizationId ? await pageServiceClient().rpc("display_types_read", { p_actor: session.user.id, p_org: organizationId }) : null;
  const kinds: KindOption[] | undefined = types?.data
    ? (types.data as { types: Array<{ code: string; name: string; active: boolean }> }).types.filter((t) => t.active).map((t) => ({ value: t.code, label: t.name }))
    : undefined;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="POGs" description="Reusable planogram layouts. Open a version to draw slots on its reference photo. Each published version is frozen; displays are assigned a published version.">
        <StatusFilter path="/pogs" current={status} params={keep} />
      </PageHeader>
      {canEdit ? <CreatePogForm organizationId={organizationId} kinds={kinds} /> : <PermissionNote>Only organization admins create and edit POGs. Managers assign published versions on the Displays page.</PermissionNote>}
      {!result.ok ? (
        <LoadFailed what="POGs" />
      ) : result.value.items.length === 0 ? (
        status !== "active" ? (
          <EmptyState title={status === "archived" ? "No archived POGs" : "No POGs"}>POGs you archive appear here and can be restored.</EmptyState>
        ) : canEdit ? (
          <EmptyState title="No POGs yet">Create the first POG with the form above.</EmptyState>
        ) : (
          <EmptyState title="No POGs yet">An organization admin creates and publishes POG layouts.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            {status === "active" ? "Active POGs" : status === "archived" ? "Archived POGs" : "All POGs"} ({result.value.items.length}
            {result.value.next_cursor ? "+" : ""})
          </h2>
          <ul className="flex flex-col gap-3">
            {result.value.items.map((pog) => (
              <PogRow key={pog.pog_id} pog={pog} canEdit={canEdit} kinds={kinds} />
            ))}
          </ul>
          <NextPageLink path="/pogs" params={{ ...keep, ...(status === "active" ? {} : { status }) }} cursor={result.value.next_cursor} />
        </div>
      )}
    </section>
  );
}
