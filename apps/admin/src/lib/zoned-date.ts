/**
 * Calendar days in an IANA time zone → UTC instants for the history API's
 * `from` (inclusive) and `to` (exclusive) filters. No date library: the
 * zone offset is read back from Intl and corrected once for DST changes.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return local - Math.floor(instant / 1000) * 1000;
}

/** Midnight at the start of `day` (YYYY-MM-DD) in `timeZone`, or null for an invalid date. */
export function startOfDay(day: string, timeZone: string): Date | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const guess = Date.UTC(y, m - 1, d);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  try {
    let instant = guess - offsetMs(guess, timeZone);
    instant = guess - offsetMs(instant, timeZone);
    return new Date(instant);
  } catch {
    return null;
  }
}

/** Inclusive day range → `{from, to}` instants; `to` is the start of the day after `last`. */
export function dayRange(first: string | undefined, last: string | undefined, timeZone: string): { from?: string; to?: string } | { error: string } {
  const from = first ? startOfDay(first, timeZone) : undefined;
  if (from === null) return { error: "Enter the start date as a valid date." };
  let to: Date | undefined;
  if (last) {
    const lastStart = startOfDay(last, timeZone);
    if (!lastStart) return { error: "Enter the end date as a valid date." };
    const next = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, Number(last.slice(8, 10)) + 1)).toISOString().slice(0, 10);
    to = startOfDay(next, timeZone) ?? undefined;
  }
  if (from && to && from >= to) return { error: "The end date must be on or after the start date." };
  return { from: from?.toISOString(), to: to?.toISOString() };
}
