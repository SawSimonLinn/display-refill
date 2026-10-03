import type { Metadata } from "next";
import Link from "next/link";
import { getPublicConfig } from "@/lib/public-config";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Placeholder only. Supabase Auth email/password sign-in arrives in feature 03;
 * this form is disabled and submits nowhere.
 */
export default function SignInPage() {
  const { configured } = getPublicConfig();
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Sign-in is not available yet. Supabase Auth is added in feature 03.
          </p>
        </div>
        <form className="flex flex-col gap-4">
          <fieldset disabled className="flex flex-col gap-4 disabled:opacity-60">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Email
              <input type="email" autoComplete="email" className="min-h-10 rounded-lg border border-input bg-background px-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Password
              <input type="password" autoComplete="current-password" className="min-h-10 rounded-lg border border-input bg-background px-3" />
            </label>
            <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 font-medium text-primary-foreground">
              Sign in
            </button>
          </fieldset>
        </form>
        <p className="text-xs text-muted-foreground">
          Public Supabase settings: {configured ? "present" : "not set (see apps/admin/.env.example)"}.
        </p>
        <Link href="/" className="text-sm font-medium underline">
          Back to overview
        </Link>
      </div>
    </main>
  );
}
