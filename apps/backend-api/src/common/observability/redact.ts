/**
 * PII and secret masking for logs (AGENTS.md §6.4): OTP codes, passwords, PINs, tokens, card data,
 * NIN and bank account numbers are never logged; phone numbers and emails are masked.
 */

const SECRET_KEY =
  /^(password|password_?hash|pin|pin_?hash|otp|otp_?code|token|access_?token|refresh_?token|id_?token|secret|client_?secret|api_?key|authorization|cookie|set-cookie|nin|bvn|account_?number|card_?number|pan|cvv|cvc|totp_?secret|secret_?encrypted|credential|device_?credential|signature)$/i;

const PHONE_E164 = /\+234\d{10}\b/g;
const PHONE_LOCAL = /\b0[789][01]\d{8}\b/g;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LONG_DIGITS = /\b\d{10,19}\b/g;

export const REDACTED = '[REDACTED]';

export function maskString(value: string): string {
  return value
    .replace(JWT, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(PHONE_E164, (phone) => `${phone.slice(0, 7)}****${phone.slice(-3)}`)
    .replace(PHONE_LOCAL, (phone) => `${phone.slice(0, 4)}****${phone.slice(-3)}`)
    .replace(EMAIL, (_match, first: string, domain: string) => `${first}***@${domain}`)
    .replace(LONG_DIGITS, (digits) => `****${digits.slice(-4)}`);
}

/** Deep copy with secrets removed and PII masked. Cycles and very deep values are cut off. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: maskString(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return output;
}
