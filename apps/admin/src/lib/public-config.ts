import { looksLikeSupabaseSecretKey } from "@display-refill/domain";

/**
 * The only configuration allowed in the browser bundle. Each variable is read
 * by its literal name so Next.js can inline it; nothing else from process.env
 * is reachable from client code.
 */
export function getPublicConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (supabasePublishableKey && looksLikeSupabaseSecretKey(supabasePublishableKey)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Replace it with the publishable key.");
  }
  return { supabaseUrl, supabasePublishableKey, configured: Boolean(supabaseUrl && supabasePublishableKey) };
}
