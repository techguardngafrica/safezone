import { describe, expect, it } from 'vitest';
import { announcementErrors, broadcastErrors } from './announcement-form';

describe('announcementErrors', () => {
  it('passes a normal announcement', () => {
    expect(announcementErrors({ title: 'Water outage', body: 'Back by 6pm.' })).toEqual({
      title: undefined,
      body: undefined,
    });
  });

  it('flags missing and too-short fields', () => {
    expect(announcementErrors({ title: '  ', body: 'ok' })).toEqual({
      title: 'announcement.form.titleRequired',
      body: 'mm.announcements.tooShort',
    });
  });
});

describe('broadcastErrors', () => {
  it('keeps the body within one SMS-sized message', () => {
    expect(broadcastErrors({ title: 'Fire', body: 'x'.repeat(321) }).body).toBe(
      'mm.announcements.tooLong',
    );
    expect(broadcastErrors({ title: 'Fire', body: 'Leave by the north gate.' }).body).toBe(
      undefined,
    );
  });

  it('needs at least 5 characters of body and caps the title at 80', () => {
    expect(broadcastErrors({ title: 'x'.repeat(81), body: 'Help' })).toEqual({
      title: 'mm.announcements.tooLong',
      body: 'mm.announcements.tooShort',
    });
  });
});
