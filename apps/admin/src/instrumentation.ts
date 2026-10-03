/** Validates server configuration at startup so a misconfigured deploy is obvious in the log. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAdminConfig } = await import("./server/config");
  const result = getAdminConfig();
  if (!result.ok) {
    console.error(result.error.message);
    console.error("API routes will respond 503 CONFIGURATION_INVALID until this is fixed.");
  }
}
