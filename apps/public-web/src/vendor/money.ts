/** Whole naira typed by a person → integer kobo, or null when it is not a positive amount. */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kobo = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(kobo) && kobo > 0 ? kobo : null;
}
