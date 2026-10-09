import { createServiceClient, listMembers, resolveAdminOrganization } from "@display-refill/server";
import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { AccessCodeCard } from "@/components/members/access-code-card";
import { InviteMemberForm } from "@/components/members/invite-member-form";
import { MemberRow } from "@/components/members/member-row";
import { getAdminConfig } from "@/server/config";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Members" };

/**
 * Organization admins invite users and assign organization/store roles.
 * Managers can reach the dashboard but not this page; changes go through
 * /api/v1/members (same checks as the iOS-facing API).
 */
export default async function MembersPage(props: PageProps<"/members">) {
  const { me, user } = await requireDashboard("/members");
  const params = await props.searchParams;
  const requested = typeof params.organization_id === "string" ? params.organization_id : undefined;
  const org = resolveAdminOrganization(me, requested);
  if (!org.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p role="alert" className="flex items-start gap-3 rounded-lg border border-border bg-card p-5">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
          <span>Only organization admins can manage members.</span>
        </p>
      </section>
    );
  }

  const config = getAdminConfig();
  const members = config.ok ? await listMembers(createServiceClient(config.config), user.id, org.value) : null;
  const stores = me.stores.filter((s) => s.organization_id === org.value).map(({ store_id, name, store_number }) => ({ store_id, name, store_number }));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground">
          Invite people by email and choose their stores. Employees use the iPhone app; managers and admins can also use this dashboard.
        </p>
      </div>
      <AccessCodeCard organizationId={org.value} />
      <InviteMemberForm organizationId={org.value} stores={stores} />
      {!members || !members.ok ? (
        <p role="alert" className="text-destructive">Members could not be loaded. Reload to try again.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">People ({members.value.length})</h2>
          <ul className="flex flex-col gap-3">
            {members.value.map((m) => (
              <MemberRow key={`${m.user_id}:${m.revision}`} member={m} organizationId={org.value} stores={stores} isSelf={m.user_id === user.id} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
