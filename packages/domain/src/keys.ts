/**
 * Detects Supabase credentials that must never reach a client bundle or the
 * iOS app: new-style secret keys and legacy JWTs whose role is service_role.
 * Pure string inspection; it does not verify signatures.
 */
export function looksLikeSupabaseSecretKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed.startsWith("sb_secret_")) return true;
  const parts = trimmed.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    return typeof payload === "object" && payload !== null && (payload as { role?: unknown }).role === "service_role";
  } catch {
    return false;
  }
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}
