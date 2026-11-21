/** Lower-case, and drop spaces and dashes so "LAG 123-AB" matches "lag123ab". */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '');
}

/**
 * Client-side filter for the gate lists (name, plate, unit). An empty search matches everything; every
 * word of the search must appear in at least one field.
 */
export function matchesVisitor(search: string, fields: (string | null | undefined)[]): boolean {
  const words = search.trim().split(/\s+/).filter(Boolean).map(normalise);
  if (words.length === 0) return true;
  const haystack = fields.filter((field): field is string => Boolean(field)).map(normalise);
  return words.every((word) => haystack.some((field) => field.includes(word)));
}
