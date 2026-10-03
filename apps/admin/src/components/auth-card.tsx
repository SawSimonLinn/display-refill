import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

/** Centered card used by the sign-in, reset and password pages. */
export function AuthCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </div>
    </main>
  );
}

/** Status message that does not rely on color alone (icon + text). */
export function Notice({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
        tone === "error" ? "border-destructive/40 text-destructive" : "border-success/40 bg-success-surface text-foreground"
      }`}
    >
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone === "error" ? "text-destructive" : "text-success"}`} />
      <span>{children}</span>
    </p>
  );
}

export function TextField(props: { label: string; name: string; type: string; autoComplete: string; required?: boolean; minLength?: number; maxLength?: number; defaultValue?: string }) {
  const { label, ...input } = props;
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input {...input} className="min-h-10 rounded-lg border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
    </label>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {children}
    </button>
  );
}

/** Sign-out is a same-origin form POST so it works without JavaScript. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post">
      <button type="submit" className={className ?? "text-sm font-medium underline"}>
        Sign out
      </button>
    </form>
  );
}
