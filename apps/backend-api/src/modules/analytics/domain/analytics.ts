/**
 * Analytics domain rules (analytics.md §4, §5, ADR-0026):
 * small-number suppression (default >= 200 users) and PII stripping for product events.
 */

export const DEFAULT_SUPPRESSION_THRESHOLD = 200;

const PII_KEY_PATTERN =
  /(phone|mobile|email|name|full_?name|address|nin|bvn|message|content|body|lat|lng|latitude|longitude|location|ip|token|password|pin)/i;

/** Strips any property key that could contain personal data (analytics.md §5 rule 4). */
export function stripPiiProperties(
  properties: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEY_PATTERN.test(key)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      clean[key] = typeof value === 'string' ? value.slice(0, 120) : value;
    }
  }
  return clean;
}

/** Suppresses cohort counts below threshold (analytics.md §5 rule 2). */
export function applySmallNumberSuppression(
  count: number,
  threshold = DEFAULT_SUPPRESSION_THRESHOLD,
): { value: number | null; suppressed: boolean } {
  if (count < threshold) return { value: null, suppressed: true };
  return { value: count, suppressed: false };
}

export function safePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}
