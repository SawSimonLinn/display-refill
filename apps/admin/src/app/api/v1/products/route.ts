import { CreateProductRequest } from "@display-refill/domain";
import { createProduct, listProducts, resolveAdminOrganization } from "@display-refill/server";
import { callerClient, handleMutation, handleRead } from "@/server/api-handlers";
import { jsonFailureOutcome } from "@/server/api-respond";

export const dynamic = "force-dynamic";

/**
 * Product catalog of one organization, oldest first. Admins and managers see
 * the organization catalog; employees only products their layouts use.
 * Archived products (`?status=archived|all`) for admins and managers.
 */
export async function GET(request: Request) {
  return handleRead(request, (ctx, query) => listProducts(callerClient(ctx), ctx.me, query));
}

/** Admin creates a product. Requires Idempotency-Key. */
export async function POST(request: Request) {
  return handleMutation(request, {
    schema: CreateProductRequest,
    routeScope: "POST /products",
    successStatus: 201,
    prepare: (ctx, body, requestId) => jsonFailureOutcome(resolveAdminOrganization(ctx.me, body.organization_id, "Only organization admins can create products."), requestId),
    execute: (service, ctx, body, org, requestId) => createProduct(service, ctx.user.id, org, body, requestId),
    resourceId: (product) => product.product_id,
    hashExtra: (org) => ({ organization_id: org }),
  });
}
