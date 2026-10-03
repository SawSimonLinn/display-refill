import { jsonError, resolveRequestId } from "@display-refill/server";

export const dynamic = "force-dynamic";

/** Unknown /api/v1 routes return the standard JSON error envelope, not HTML. */
function notFound(request: Request) {
  return jsonError("NOT_FOUND", "No such API route.", resolveRequestId(request.headers));
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
