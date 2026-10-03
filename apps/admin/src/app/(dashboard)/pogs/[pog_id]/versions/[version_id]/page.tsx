import { Uuid } from "@display-refill/domain";
import { getPogVersion, listProductOptions, pogImageAccess } from "@display-refill/server";
import { ArrowLeft, CircleCheck, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LoadFailed, PermissionNote } from "@/components/catalog/list-parts";
import { PogEditor } from "@/components/pog-editor/pog-editor";
import { NewDraftAction, PogViewer } from "@/components/pog-editor/pog-viewer";
import { pageServiceClient, sessionCaller } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "POG version" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/**
 * One POG version. Admins edit drafts (reference image, slots, publish) and
 * create new drafts from published versions; published versions and every
 * version a manager can see are read-only.
 */
export default async function PogVersionPage(props: PageProps<"/pogs/[pog_id]/versions/[version_id]">) {
  const session = await requireDashboard("/pogs");
  const { pog_id: pogId, version_id: versionId } = await props.params;
  const search = await props.searchParams;
  if (!Uuid.safeParse(pogId).success || !Uuid.safeParse(versionId).success) notFound();

  const caller = sessionCaller(session);
  const result = await getPogVersion(caller, versionId, pogId);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <LoadFailed what="This POG version" />;
  }
  const detail = result.value;
  const isAdmin = session.me.capabilities.admin_organization_ids.includes(detail.organization_id);
  const editable = isAdmin && detail.state === "draft";

  // Signed only after the RLS read above showed the caller may see this version.
  const image = detail.reference ? await pogImageAccess(caller, pageServiceClient(), versionId) : null;
  const imageUrl = image?.ok ? image.value.url : null;
  const products = editable ? await listProductOptions(caller, detail.organization_id) : null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/pogs" className="flex items-center gap-1 self-start text-sm font-medium underline">
          <ArrowLeft aria-hidden className="size-4" /> POGs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {detail.pog_name} · version {detail.version_number}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {detail.state === "published" ? (
            <>
              <Lock aria-hidden className="size-4" /> Published {detail.published_at ? `${dateFormat.format(new Date(detail.published_at))} UTC` : ""}. Read-only: published
              versions never change, so scans keep the layout they were taken with.
            </>
          ) : (
            <>Draft{detail.source_version_id ? " copied from a published version" : ""}. Changes here do not affect any display until this version is published and assigned.</>
          )}
        </p>
      </div>

      {search.published === "1" && detail.state === "published" ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-border bg-success-surface p-3 text-sm">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            Version {detail.version_number} is published. Displays still use their current version until a manager or admin assigns this one on the{" "}
            <Link href="/displays" className="font-medium underline">
              Displays
            </Link>{" "}
            page.
          </span>
        </p>
      ) : null}

      {detail.reference && !imageUrl ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
          The reference image file could not be loaded. Slot positions are shown on a blank frame of the same shape.
        </p>
      ) : null}

      {editable ? (
        products && products.ok ? (
          <PogEditor key={`${detail.pog_version_id}:${detail.revision}`} detail={detail} imageUrl={imageUrl} products={products.value} />
        ) : (
          <LoadFailed what="The product list" />
        )
      ) : (
        <>
          {isAdmin && detail.state === "published" ? <NewDraftAction detail={detail} /> : null}
          {!isAdmin ? <PermissionNote>Only organization admins edit and publish POGs. Managers assign published versions on the Displays page.</PermissionNote> : null}
          <PogViewer detail={detail} imageUrl={imageUrl} />
        </>
      )}
    </section>
  );
}
