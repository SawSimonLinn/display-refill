import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, Notice, SignOutButton } from "@/components/auth-card";
import { getWebSession } from "@/server/session";

export const metadata: Metadata = { title: "No access" };

/** Destination for signed-in users who may not use the web dashboard. Never redirects. */
export default async function NoAccessPage(props: PageProps<"/no-access">) {
  const params = await props.searchParams;
  const session = await getWebSession();
  const employee = params.reason === "employee";
  return (
    <AuthCard title={employee ? "Use the iPhone app" : "No access"}>
      <Notice tone="error">
        {employee
          ? "Your account is for store checks in the Display Refill iPhone app. The web dashboard is for managers and administrators."
          : "Your account does not have access to any organization. Contact your administrator."}
      </Notice>
      {session.state === "signed_in" ? (
        <>
          <p className="text-sm text-muted-foreground">Signed in as {session.user.email ?? "your account"}.</p>
          <Link href="/account/password" className="text-sm font-medium underline">
            Change password
          </Link>
          <SignOutButton />
        </>
      ) : (
        <Link href="/sign-in" className="text-sm font-medium underline">
          Sign in
        </Link>
      )}
    </AuthCard>
  );
}
