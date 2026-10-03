/**
 * Fixed-window, in-process rate limiter for password-sensitive operations
 * and invitations. Per server process only: a multi-instance deployment
 * needs a shared store (feature 12). Supabase Auth applies its own limits
 * on top (sign-in, email sending).
 */
export interface RateLimiter {
  /** Counts one attempt for `key`; returns seconds to wait when over the limit. */
  hit(key: string, now?: number): { allowed: true } | { allowed: false; retryAfterSeconds: number };
}

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  const maxKeys = options.maxKeys ?? 10_000;
  return {
    hit(key, now = Date.now()) {
      let entry = windows.get(key);
      if (!entry || now - entry.start >= options.windowMs) {
        if (!entry && windows.size >= maxKeys) {
          for (const [k, v] of windows) if (now - v.start >= options.windowMs) windows.delete(k);
          // Still full: drop the oldest key rather than grow without bound.
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value!);
        }
        entry = { start: now, count: 0 };
        windows.set(key, entry);
      }
      entry.count += 1;
      if (entry.count <= options.limit) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + options.windowMs - now) / 1000)) };
    },
  };
}
