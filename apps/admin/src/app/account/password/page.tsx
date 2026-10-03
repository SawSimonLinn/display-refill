import { PASSWORD_MIN_LENGTH } from "@display-refill/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, Notice, SignOutButton, SubmitButton, TextField } from "@/components/auth-card";
import { requireSignedIn } from "@/server/session";

export const metadata: Metadata = { title: "Choose a password" };

const ERRORS: Record<string, string> = {
  weak: `Use at least ${PASSWORD_MIN_LENGTH} characters (at most 72).`,
  mismatch: "The two passwords do not match.",
  same: "Choose a password different from your current one.",
  rate_limited: "Too many attempts. Try again later.",
  failed: "The password could not be changed. Try again.",
  request: "That request could not be verified. Reload the page and try again.",
};

/** Any signed-in user may set their password; employees then use the iOS app. */
export default async function PasswordPage(props: PageProps<"/account/password">) {
  const session = await requireSignedIn("/account/password");
  const params = await props.searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const from = params.from === "invite" || params.from === "recovery" ? params.from : undefined;

  if (params.updated) {
    return (
      <AuthCard title="Password saved">
        <Notice tone="success">Your password has been updated.</Notice>
        {session.me.capabilities.dashboard ? (
          <Link href="/" className="text-sm font-medium underline">
            Continue to Display Refill
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">Sign in on the Display Refill iPhone app with your email and this password.</p>
        )}
        <SignOutButton />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={from === "invite" ? "Welcome — choose a password" : "Choose a new password"}
      description={<>Signed in as {session.user.email ?? "your account"}.</>}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action="/auth/set-password" method="post" className="flex flex-col gap-4">
        {from ? <input type="hidden" name="from" value={from} /> : null}
        <TextField label="New password" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={72} />
        <TextField label="Confirm new password" name="confirm_password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={72} />
        <SubmitButton>Save password</SubmitButton>
      </form>
    </AuthCard>
  );
}
