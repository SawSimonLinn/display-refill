"use client";

import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";

const inputClass = "tabular min-h-10 w-full rounded-lg border border-input bg-background px-3 aria-[invalid=true]:border-destructive disabled:opacity-60";

/** Normalized 0–1 value shown as a percentage with up to 4 decimals. */
export const formatPercent = (value: number) => String(Number((value * 100).toFixed(4)));

/**
 * A normalized coordinate typed as a percentage. The value is applied when
 * the field is committed (Enter or leaving it). Out-of-range or non-numeric
 * input is refused with a message, never clamped silently.
 */
export function PercentField(props: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  onValidityChange?: (invalid: boolean) => void;
  /** Allowed range in percent, inclusive unless noted. */
  min: number;
  max: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
  errors?: string[];
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const shown = text ?? formatPercent(props.value);
  const errors = [...(local ? [local] : []), ...(props.errors ?? [])];

  function commit() {
    if (text === null) return;
    const raw = text.trim().replace(",", ".").replace(/%$/, "");
    const n = Number(raw);
    const low = props.minExclusive ? n <= props.min : n < props.min;
    const high = props.maxExclusive ? n >= props.max : n > props.max;
    if (raw === "" || !Number.isFinite(n) || low || high) {
      props.onValidityChange?.(true);
      setLocal(`Enter a number ${props.minExclusive ? "above" : "from"} ${props.min} ${props.maxExclusive ? "and below" : "to"} ${props.max}.`);
      return;
    }
    if (Math.abs(n * 1e4 - Math.round(n * 1e4)) > 1e-6) {
      props.onValidityChange?.(true);
      setLocal("Use at most 4 decimal places.");
      return;
    }
    props.onValidityChange?.(false);
    setLocal(null);
    setText(null);
    props.onCommit(Math.round(n * 1e4) / 1e6);
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {props.label} <span className="font-normal text-muted-foreground">(%)</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        disabled={props.disabled}
        onFocus={() => setText(formatPercent(props.value))}
        onChange={(e) => {
          setText(e.target.value);
          props.onValidityChange?.(true); // uncommitted text must be committed before save/publication
        }}
        onBlur={() => {
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setText(null);
            setLocal(null);
            props.onValidityChange?.(false);
          }
        }}
        aria-invalid={errors.length ? true : undefined}
        aria-describedby={errors.length ? `${id}-error` : undefined}
        className={inputClass}
      />
      {errors.length ? <FieldError id={`${id}-error`} messages={errors} /> : null}
    </div>
  );
}

/** Whole-number or text field whose raw text is kept in the editor state (validated on save). */
export function PlainField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  numeric?: boolean;
  maxLength?: number;
  hint?: string;
  errors?: string[];
  disabled?: boolean;
}) {
  const id = useId();
  const described = [props.hint ? `${id}-hint` : null, props.errors?.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {props.label}
        {props.optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </label>
      <input
        id={id}
        type="text"
        inputMode={props.numeric ? "numeric" : "text"}
        autoComplete="off"
        maxLength={props.maxLength}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.errors?.length ? true : undefined}
        aria-describedby={described}
        className={inputClass}
      />
      {props.hint ? (
        <span id={`${id}-hint`} className="text-muted-foreground">
          {props.hint}
        </span>
      ) : null}
      {props.errors?.length ? <FieldError id={`${id}-error`} messages={props.errors} /> : null}
    </div>
  );
}

export function FieldError({ id, messages }: { id: string; messages: string[] }) {
  return (
    <span id={id} className="flex items-start gap-1 text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {messages.join(" ")}
    </span>
  );
}
