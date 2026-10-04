/** Validates server configuration at startup so a misconfigured deploy is obvious in the log. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAdminConfig } = await import("./server/config");
  const result = getAdminConfig();
  if (!result.ok) {
    console.error(result.error.message); // Names and validation rules only, never values.
    process.exit(78); // EX_CONFIG: do not leave a listening but unprepared server running.
  }
}
