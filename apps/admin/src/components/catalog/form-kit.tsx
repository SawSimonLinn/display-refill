"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useId, useRef, useState } from "react";
import { type ApiFailure, apiRequest } from "@/lib/api-client";

/**
 * Runs one API mutation at a time. The Idempotency-Key belongs to the exact
 * request: retrying the same request (after a network error, say) reuses it,
 * so the server applies the change at most once; any edit makes a new key.
 */
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const attempt = useRef<{ request: string; key: string } | null>(null);

  async function run<T>(path: string, method: "POST" | "PATCH" | "PUT", body: unknown): Promise<T | null> {
    const request = JSON.stringify([method, path, body]);
    if (attempt.current?.request !== request) attempt.current = { request, key: crypto.randomUUID() };
    setBusy(true);
    setFailure(null);
    const result = await apiRequest<T>(path, { method, body, idempotencyKey: attempt.current.key });
    setBusy(false);
    if (!result.ok) {
      setFailure(result.failure);
      return null;
    }
    attempt.current = null;
    return result.data;
  }

  return { busy, failure, run, clear: () => setFailure(null) };
}

/**
 * Edit state that only remembers the fields the user changed. Untouched
 * fields always show the latest server values (after a reload, too), and
 * `changes` holds just the edited fields, so saving after a conflict never
 * sends back stale values for fields someone else changed meanwhile.
 */
export function useEdits<T extends Record<string, string>>(current: T) {
  const [edits, setEdits] = useState<Partial<T>>({});
  const value = { ...current, ...edits } as T;
  const onChange = (next: T) =>
    setEdits((prev) => {
      const out: Partial<T> = { ...prev };
      for (const k of Object.keys(next) as Array<keyof T>) if (next[k] !== value[k]) out[k] = next[k];
      return out;
    });
  const changes = Object.fromEntries(Object.entries(edits).filter(([k, v]) => v !== current[k])) as Partial<T>;
  return { value, onChange, changes, reset: () => setEdits({}) };
}

/** Field errors the API returned for `name`, if the last attempt failed validation. */
export const errorsFor = (failure: ApiFailure | null, name: string) => (failure?.kind === "validation" ? failure.fieldErrors[name] : undefined);

const inputClass =
  "min-h-10 rounded-lg border border-input bg-background px-3 font-normal aria-[invalid=true]:border-destructive disabled:opacity-60";

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  required?: boolean;
  maxLength?: number;
  hint?: string;
  list?: string;
  inputMode?: "text" | "numeric";
  autoComplete?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const described = [props.hint ? `${id}-hint` : null, props.errors?.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {props.label}
        {props.required ? null : <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      <input
        id={id}
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        maxLength={props.maxLength}
        list={props.list}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete ?? "off"}
        disabled={props.disabled}
        aria-invalid={props.errors?.length ? true : undefined}
        aria-describedby={described}
        className={inputClass}
      />
      {props.hint ? (
        <span id={`${id}-hint`} className="text-muted-foreground">
          {props.hint}
        </span>
      ) : null}
      {props.errors?.length ? (
        <span id={`${id}-error`} className="flex items-center gap-1 text-destructive">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {props.errors.join("; ")}
        </span>
      ) : null}
    </div>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  errors?: string[];
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const described = [props.hint ? `${id}-hint` : null, props.errors?.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        aria-invalid={props.errors?.length ? true : undefined}
        aria-describedby={described}
        className={`${inputClass} px-2`}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {props.hint ? (
        <span id={`${id}-hint`} className="text-muted-foreground">
          {props.hint}
        </span>
      ) : null}
      {props.errors?.length ? (
        <span id={`${id}-error`} className="flex items-center gap-1 text-destructive">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {props.errors.join("; ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Explains a failed save in words (never color alone) and offers the next
 * step. Form input stays in place for every kind of failure.
 */
export function FailureNotice({ failure, what }: { failure: ApiFailure | null; what: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (!failure) return null;

  let body: ReactNode;
  switch (failure.kind) {
    case "session":
      body = (
        <>
          Your session has ended. Your changes are still in the form —{" "}
          <Link href={`/sign-in?next=${encodeURIComponent(pathname)}`} className="font-medium underline">
            sign in again
          </Link>{" "}
          in this tab, then save.
        </>
      );
      break;
    case "forbidden":
      body = <>You don’t have permission to do that. {failure.message}</>;
      break;
    case "not_found":
      body = <>This {what} no longer exists or you no longer have access to it. Reload the page.</>;
      break;
    case "conflict":
      body =
        failure.code === "CONFLICT" && /changed|revision/i.test(failure.message) ? (
          <>
            This {what} was changed by someone else after you opened it, so your save was not applied. Reload to see the latest values; your
            edits stay in the form so you can save them again.
          </>
        ) : (
          <>{failure.message}</>
        );
      break;
    case "validation": {
      const general = [...(failure.fieldErrors.request ?? [])];
      body = <>Check the highlighted fields.{general.length ? ` ${general.join("; ")}` : ""}</>;
      break;
    }
    default:
      body = <>{failure.message} Your changes are still in the form; try again.</>;
  }

  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 text-foreground">{body}</p>
      {failure.kind === "conflict" || failure.kind === "not_found" ? (
        <button type="button" onClick={() => router.refresh()} className="flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 font-medium text-foreground">
          <RefreshCw aria-hidden className="size-4" />
          Reload latest
        </button>
      ) : null}
    </div>
  );
}

export function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <button type="submit" disabled={busy} aria-disabled={busy} className="min-h-10 self-start rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">
      {busy ? busyLabel : children}
    </button>
  );
}

/** `subject` names the row's record so repeated buttons are distinguishable to screen readers ("Edit North"). */
export function SecondaryButton({ onClick, disabled, children, subject, tone = "neutral" }: { onClick: () => void; disabled?: boolean; children: string; subject?: string; tone?: "neutral" | "destructive" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={subject ? `${children} ${subject}` : undefined}
      className={`min-h-10 rounded-lg px-3 text-sm font-medium disabled:opacity-60 ${tone === "destructive" ? "border border-destructive/50 text-destructive" : "border border-border"}`}
    >
      {children}
    </button>
  );
}
