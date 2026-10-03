import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, Notice, SubmitButton, TextField } from "@/components/auth-card";

export const metadata: Metadata = { title: "Reset password" };

const ERRORS: Record<string, string> = {
  invalid: "Enter a valid email address.",
  rate_limited: "Too many reset requests. Try again later.",
  request: "That request could not be verified. Reload the page and try again.",
};

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const params = await props.searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  return (
    <AuthCard title="Reset password" description="We will email you a link to choose a new password.">
      {params.sent ? (
        <Notice tone="success">If an account exists for that address, a reset link is on its way. The link expires in one hour.</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form action="/auth/forgot-password" method="post" className="flex flex-col gap-4">
        <TextField label="Email" name="email" type="email" autoComplete="email" required maxLength={254} />
        <SubmitButton>Send reset link</SubmitButton>
      </form>
      <Link href="/sign-in" className="text-sm font-medium underline">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
