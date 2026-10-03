import { UpdateProductRequest } from "@display-refill/domain";
import { updateProduct } from "@display-refill/server";
import { handleMutation, requireSomeAdmin, uuidParam } from "@/server/api-handlers";

export const dynamic = "force-dynamic";

/**
 * Admin edits product metadata or archives/restores it. Renames never change
 * existing scan snapshots. Requires expected_revision and Idempotency-Key.
 */
export async function PATCH(request: Request, route: RouteContext<"/api/v1/products/[product_id]">) {
  const { product_id: productId } = await route.params;
  return handleMutation(request, {
    schema: UpdateProductRequest,
    routeScope: `PATCH /products/${productId}`,
    successStatus: 200,
    prepare: (ctx, _body, requestId) => {
      const id = uuidParam(productId, "Product", requestId);
      return id.ok ? requireSomeAdmin(ctx, "Only organization admins can change products.", requestId) : id;
    },
    execute: (service, ctx, body, _prepared, requestId) => updateProduct(service, ctx.user.id, productId, body, requestId),
    resourceId: (product) => product.product_id,
  });
}
