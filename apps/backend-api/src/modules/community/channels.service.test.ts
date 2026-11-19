import { describe, expect, it } from 'vitest';
import { otherDirectUserId } from './channels.service';

describe('otherDirectUserId', () => {
  it('returns the other participant from a sorted direct channel key', () => {
    expect(otherDirectUserId('user-a:user-b', 'user-a')).toBe('user-b');
    expect(otherDirectUserId('user-a:user-b', 'user-b')).toBe('user-a');
  });

  it('returns null for missing, malformed, or unrelated keys', () => {
    expect(otherDirectUserId(null, 'user-a')).toBeNull();
    expect(otherDirectUserId('general', 'user-a')).toBeNull();
    expect(otherDirectUserId('user-a:user-b', 'user-c')).toBeNull();
  });
});
