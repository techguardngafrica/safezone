import { describe, expect, it } from 'vitest';
import { t } from './index';

describe('t()', () => {
  it('returns English strings', () => {
    expect(t('sos.button')).toBe('SOS');
  });

  it('replaces placeholders', () => {
    expect(t('sos.cancel', { seconds: 5 })).toBe('Cancel alert (5s)');
  });

  it('leaves unknown placeholders intact', () => {
    expect(t('auth.otp.sent')).toBe('We sent a code to {phone}');
  });
});
