/**
 * Client-side checks for the compose form, matching the API limits (`packages/schemas`): announcement
 * title 3-120 and body 3-4000; emergency broadcast title 3-80 and body 5-320 (it goes out by SMS).
 * Returns i18n keys so this file stays pure.
 */
export interface ComposeErrors {
  title?: string;
  body?: string;
}

function check(
  value: string,
  min: number,
  max: number,
  required: string,
  tooShort: string,
  tooLong: string,
): string | undefined {
  const length = value.trim().length;
  if (length === 0) return required;
  if (length < min) return tooShort;
  if (length > max) return tooLong;
  return undefined;
}

export function announcementErrors(input: { title: string; body: string }): ComposeErrors {
  return {
    title: check(
      input.title,
      3,
      120,
      'announcement.form.titleRequired',
      'mm.announcements.tooShort',
      'mm.announcements.tooLong',
    ),
    body: check(
      input.body,
      3,
      4000,
      'announcement.form.bodyRequired',
      'mm.announcements.tooShort',
      'mm.announcements.tooLong',
    ),
  };
}

export function broadcastErrors(input: { title: string; body: string }): ComposeErrors {
  return {
    title: check(
      input.title,
      3,
      80,
      'announcement.form.titleRequired',
      'mm.announcements.tooShort',
      'mm.announcements.tooLong',
    ),
    body: check(
      input.body,
      5,
      320,
      'announcement.form.bodyRequired',
      'mm.announcements.tooShort',
      'mm.announcements.tooLong',
    ),
  };
}
