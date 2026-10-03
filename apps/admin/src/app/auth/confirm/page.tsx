import { AuthLinkType } from "@display-refill/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, Notice, SubmitButton } from "@/components/auth-card";

export const metadata: Metadata = { title: "Continue", referrer: "no-referrer" };

/**
 * Landing page for invite and recovery email links. It does not consume the
 * token on GET (mail scanners prefetch links); the button POSTs it to
 * /auth/verify. The token is never placed in a redirect target.
 */
export default async function ConfirmPage(props: PageProps<"/auth/confirm">) {
  const params = await props.searchParams;
  const type = AuthLinkType.safeParse(params.type);
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";

  if (params.error || !type.success || !tokenHash) {
    return (
      <AuthCard title="Link not valid">
        <Notice tone="error">
          {params.error === "expired"
            ? "This link has expired or was already used."
            : "This link is incomplete or not valid."}{" "}
          Ask your administrator for a new invitation, or request a new reset link.
        </Notice>
        <Link href="/forgot-password" className="text-sm font-medium underline">
          Request a password reset
        </Link>
      </AuthCard>
    );
  }

  const invite = type.data === "invite";
  return (
    <AuthCard
      title={invite ? "Accept invitation" : "Reset password"}
      description={invite ? "Continue to choose a password for your Display Refill account." : "Continue to choose a new password."}
    >
      <form action="/auth/verify" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type.data} />
        <SubmitButton>Continue</SubmitButton>
      </form>
    </AuthCard>
  );
}
