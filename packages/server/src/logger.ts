import type { LogLevel } from "./config";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(key|secret|password|token|authorization|cookie|database_url|signed_url|upload_url|body|prompt|email|bytes|image|response|payload)/i;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Replaces values under credential-like keys, recursively. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: "Error", code: "OPERATION_FAILED" };
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : redact(child, depth + 1)]),
    );
  }
  if (typeof value === "string" && (/https?:|postgres(?:ql)?:|Bearer |eyJ|sb_secret_|sk-|@|data:/i.test(value) || value.length > 200)) return "[redacted]";
  return value;
}

/** Structured JSON-lines logger for the API and worker. */
export function createLogger(service: string, level: LogLevel = "info", write = defaultWrite): Logger {
  const emit = (entryLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const entry = { time: new Date().toISOString(), level: entryLevel, service, message: redact(message), ...(redact(fields ?? {}) as LogFields) };
    write(entryLevel, JSON.stringify(entry));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

function defaultWrite(level: LogLevel, line: string) {
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}
