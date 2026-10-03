import { CreatePogRequest } from "@display-refill/domain";
import { createPog, listPogs, resolveAdminOrganization } from "@display-refill/server";
import { callerClient, handleMutation, handleRead } from "@/server/api-handlers";
import { jsonFailureOutcome } from "@/server/api-respond";

export const dynamic = "force-dynamic";

/** Reusable POG identities with the versions the caller may see (admins: drafts too). */
export async function GET(request: Request) {
  return handleRead(request, (ctx, query) => listPogs(callerClient(ctx), ctx.me, query));
}

/**
 * Admin creates a reusable POG identity and its empty draft version 1.
 * Slots, reference images and publication use the /pog-versions routes. Requires
 * Idempotency-Key.
 */
export async function POST(request: Request) {
  return handleMutation(request, {
    schema: CreatePogRequest,
    routeScope: "POST /pogs",
    successStatus: 201,
    prepare: (ctx, body, requestId) => jsonFailureOutcome(resolveAdminOrganization(ctx.me, body.organization_id, "Only organization admins can create POGs."), requestId),
    execute: (service, ctx, body, org, requestId) => createPog(service, ctx.user.id, org, body, requestId),
    resourceId: (pog) => pog.pog_id,
    hashExtra: (org) => ({ organization_id: org }),
  });
}
