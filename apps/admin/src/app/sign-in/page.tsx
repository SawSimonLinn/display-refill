import { safeNextPath } from "@display-refill/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, Notice, SubmitButton, TextField } from "@/components/auth-card";
import { getPublicConfig } from "@/lib/public-config";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  unavailable: "Sign-in is temporarily unavailable. Try again shortly.",
  expired: "Your session ended. Sign in again.",
  request: "That request could not be verified. Reload the page and try again.",
};

/**
 * Email/password sign-in (Supabase Auth). Accounts are created by invitation
 * only; there is no sign-up link. Never redirects, so it cannot loop.
 */
export default async function SignInPage(props: PageProps<"/sign-in">) {
  const params = await props.searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const { configured } = getPublicConfig();
  return (
    <AuthCard title="Sign in" description="Display Refill admin. Create your account in the iPhone app, or accept an invitation.">
      {params.signed_out ? <Notice tone="success">You have signed out.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!configured ? <Notice tone="error">Sign-in is not configured on this server.</Notice> : null}
      <form action="/auth/sign-in" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required maxLength={254} />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
        <SubmitButton>Sign in</SubmitButton>
      </form>
      <Link href="/forgot-password" className="text-sm font-medium underline">
        Forgot password?
      </Link>
    </AuthCard>
  );
}
