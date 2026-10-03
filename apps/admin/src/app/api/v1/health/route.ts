import { API_VERSION, type HealthStatus } from "@display-refill/domain";
import { jsonData, jsonError, resolveRequestId } from "@display-refill/server";
import { getAdminConfig, getLogger } from "@/server/config";

export const dynamic = "force-dynamic";

/**
 * Liveness plus configuration check. It does not contact Supabase and does not
 * imply authentication exists; those checks report their real status.
 */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const config = getAdminConfig();
  if (!config.ok) {
    getLogger().error("health: configuration invalid", {
      request_id: requestId,
      variables: config.error.problems.map((p) => p.variable),
    });
    return jsonError("CONFIGURATION_INVALID", "The server is missing required configuration. See the server log.", requestId);
  }
  const body: HealthStatus = {
    status: "ok",
    service: "admin-api",
    api_version: API_VERSION,
    checked_at: new Date().toISOString(),
    checks: {
      configuration: "ok",
      database: "not_checked",
      authentication: "not_implemented",
      job_queue: "not_implemented",
    },
  };
  return jsonData(body, requestId);
}
