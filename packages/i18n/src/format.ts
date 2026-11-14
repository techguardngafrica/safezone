/** Estate times are shown in WAT (AGENTS.md §5.4). */
const DEFAULT_TIMEZONE = 'Africa/Lagos';

/** Times are stored in UTC and shown in WAT (AGENTS.md §5.4). */
const dateTime = new Intl.DateTimeFormat('en-NG', {
  timeZone: DEFAULT_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-NG', {
  timeZone: DEFAULT_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeOnly = new Intl.DateTimeFormat('en-NG', {
  timeZone: DEFAULT_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '-';
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : '-';
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? timeOnly.format(new Date(iso)) : '-';
}

/** "4m 12s" style elapsed time for live timers. */
export function formatElapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

/** Money is integer kobo (AGENTS.md §5.4). */
export function formatKobo(kobo: number): string {
  return naira.format(kobo / 100);
}

/** Start of today in WAT as an ISO string. WAT is a fixed UTC+1 with no daylight saving. */
export function startOfTodayWat(now = new Date()): string {
  const hourMs = 3_600_000;
  const wat = new Date(now.getTime() + hourMs);
  const midnightUtc = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate());
  return new Date(midnightUtc - hourMs).toISOString();
}
