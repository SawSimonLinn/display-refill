import { resolveAdminOrganization } from "@display-refill/server";
import type { Metadata } from "next";
import { PageHeader, PermissionNote } from "@/components/catalog/list-parts";
import { DisplayTypesManager } from "@/components/display-types/display-types-manager";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Display types" };

/** Organization admins define display case types, their products and default PAR (Feature 16). */
export default async function DisplayTypesPage(props: PageProps<"/display-types">) {
  const { me } = await requireDashboard("/display-types");
  const params = await props.searchParams;
  const org = resolveAdminOrganization(me, typeof params.organization_id === "string" ? params.organization_id : undefined, "Only organization admins manage display case types.");
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Display types"
        description="The kinds of display case a store can have. Each store picks the ones it has; products and default PAR here reach every store using the type. Store managers can override PAR for their own store in Production → PAR setup."
      />
      {org.ok ? <DisplayTypesManager organizationId={org.value} /> : <PermissionNote>Only organization admins manage display case types. Store managers choose their store&apos;s types in Production → PAR setup.</PermissionNote>}
    </section>
  );
}
