import { listProducts } from "@display-refill/server";
import type { Metadata } from "next";
import { EmptyState, LoadFailed, NextPageLink, PageHeader, PermissionNote, StatusFilter, statusParam, stringParam } from "@/components/catalog/list-parts";
import { CreateProductForm, ProductRow } from "@/components/products/product-forms";
import { sessionCaller } from "@/server/page-data";
import { requireDashboard } from "@/server/session";

export const metadata: Metadata = { title: "Products" };

/**
 * Organization product catalog. Admins create, edit and archive products;
 * managers read the catalog. Products are archived, never deleted, so scan
 * history keeps its references.
 */
export default async function ProductsPage(props: PageProps<"/products">) {
  const session = await requireDashboard("/products");
  const { me } = session;
  const params = await props.searchParams;
  const status = statusParam(params.status);
  const organizationId = stringParam(params.organization_id) ?? me.organizations[0]?.organization_id;
  const result = await listProducts(sessionCaller(session), me, { status, cursor: stringParam(params.cursor), limit: 50, organization_id: organizationId });
  const canEdit = organizationId !== undefined && me.capabilities.admin_organization_ids.includes(organizationId);
  const keep = { ...(organizationId && me.organizations.length > 1 ? { organization_id: organizationId } : {}) };

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Products" description="The catalog that POG slots point to. Names here are copied into each scan when it starts.">
        <StatusFilter path="/products" current={status} params={keep} />
      </PageHeader>
      {canEdit ? (
        <CreateProductForm organizationId={organizationId} />
      ) : (
        <PermissionNote>Only organization admins can add, edit or archive products. Managers can view the catalog.</PermissionNote>
      )}
      {!result.ok ? (
        <LoadFailed what="Products" />
      ) : result.value.items.length === 0 ? (
        status !== "active" ? (
          <EmptyState title={status === "archived" ? "No archived products" : "No products"}>Products you archive appear here and can be restored.</EmptyState>
        ) : canEdit ? (
          <EmptyState title="No products yet">Add the first product with the form above. Products are needed before a POG layout can be drawn.</EmptyState>
        ) : (
          <EmptyState title="No products yet">An organization admin adds products to the catalog.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            {status === "active" ? "Active products" : status === "archived" ? "Archived products" : "All products"} ({result.value.items.length}
            {result.value.next_cursor ? "+" : ""})
          </h2>
          <ul className="flex flex-col gap-3">
            {result.value.items.map((product) => (
              <ProductRow key={product.product_id} product={product} canEdit={canEdit} />
            ))}
          </ul>
          <NextPageLink path="/products" params={{ ...keep, ...(status === "active" ? {} : { status }) }} cursor={result.value.next_cursor} />
        </div>
      )}
    </section>
  );
}
