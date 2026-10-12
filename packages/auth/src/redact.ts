const REDACTED = "[REDACTED]";
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

/** Returns a logging-safe copy without mutating input. Circular references are marked. */
export function redactSensitive<T>(value: T): T {
  return redact(value, new WeakSet<object>()) as T;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return value.replace(BEARER_VALUE, `Bearer ${REDACTED}`);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(entry, seen);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized === "code" ||
    normalized.endsWith("verificationcode") ||
    normalized === "otp"
  );
}
