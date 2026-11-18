/**
 * Naira text typed by staff ↔ integer kobo sent to the API (AGENTS §5.4: money is never a float).
 * Parsing works on the digits, not with floating-point maths, so "0.29" is exactly 29 kobo.
 */

/** ₦1,000,000,000 in kobo, the API's ceiling (`MAX_KOBO` in packages/schemas). */
const MAX_KOBO = 100_000_000_000;

/** "15,000.50" → 1500050. Null for empty, negative, more than 2 decimals or over the ceiling. */
export function parseNaira(text: string): number | null {
  const cleaned = text.replace(/[₦,\s]/g, '').replace(/^NGN/i, '');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const naira = match[1] ?? '0';
  const kobo = (match[2] ?? '').padEnd(2, '0');
  const value = Number(naira) * 100 + Number(kobo);
  if (!Number.isSafeInteger(value) || value > MAX_KOBO) return null;
  return value;
}

/** Like parseNaira, but zero is not an amount. */
export function parsePositiveNaira(text: string): number | null {
  const value = parseNaira(text);
  return value !== null && value > 0 ? value : null;
}

/** 1500050 → "15000.50" for an input's starting value (no grouping, so it parses back). */
export function koboToInput(kobo: number): string {
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  return rest === 0 ? String(naira) : `${naira}.${String(rest).padStart(2, '0')}`;
}

/** "5" → 500 basis points (5%); "2.5" → 250. Null outside 0.01% to 50% or past 2 decimals. */
export function parsePercentToBasisPoints(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/%$/, ''));
  if (!match) return null;
  const points = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return points >= 1 && points <= 5000 ? points : null;
}

/** 250 → "2.5". */
export function basisPointsToInput(points: number): string {
  return String(points / 100);
}
