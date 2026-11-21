/** WAT is a fixed UTC+1 with no daylight saving (AGENTS.md §5.4). */
const WAT_OFFSET_MS = 3_600_000;

function watDate(now: Date): string {
  return new Date(now.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** First day of this month to today, as WAT calendar dates (`YYYY-MM-DD`), for report ranges. */
export function monthToDateWat(now = new Date()): { from: string; to: string } {
  const to = watDate(now);
  return { from: `${to.slice(0, 8)}01`, to };
}
