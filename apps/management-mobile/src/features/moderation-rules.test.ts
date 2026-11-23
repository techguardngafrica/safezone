import { describe, expect, it } from 'vitest';
import {
  isDestructiveModeration,
  moderationActionsFor,
  moderationInputValid,
} from './moderation-rules';

describe('moderationActionsFor', () => {
  it('offers message-appropriate actions including remove and dismiss', () => {
    expect(moderationActionsFor('message')).toEqual([
      'remove_message',
      'warn',
      'mute',
      'dismiss_report',
    ]);
  });

  it('offers channel suspension for channel reports', () => {
    expect(moderationActionsFor('channel')).toContain('suspend_channel');
    expect(moderationActionsFor('channel')).not.toContain('remove_message');
  });

  it('offers user actions for member reports', () => {
    expect(moderationActionsFor('user')).toEqual([
      'warn',
      'mute',
      'remove_from_channel',
      'dismiss_report',
    ]);
  });
});

describe('moderationInputValid & isDestructiveModeration', () => {
  it('requires at least 3 chars for reason and positive duration for mute', () => {
    expect(moderationInputValid('dismiss_report', 'no')).toBe(false);
    expect(moderationInputValid('dismiss_report', 'No rule broken')).toBe(true);
    expect(moderationInputValid('mute', 'Repeated spam')).toBe(false);
    expect(moderationInputValid('mute', 'Repeated spam', 24)).toBe(true);
  });

  it('marks removal, mute and suspension as destructive, warn and dismiss as non-destructive', () => {
    expect(isDestructiveModeration('remove_message')).toBe(true);
    expect(isDestructiveModeration('suspend_channel')).toBe(true);
    expect(isDestructiveModeration('warn')).toBe(false);
    expect(isDestructiveModeration('dismiss_report')).toBe(false);
  });
});
