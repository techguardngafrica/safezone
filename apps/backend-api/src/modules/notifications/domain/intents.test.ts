import { describe, expect, it } from 'vitest';
import {
  extractPlaceholders,
  INTENTS,
  isCustomisableEstateIntent,
  renderTemplate,
  resolveChannels,
  type IntentDefinition,
} from './intents';

const optional: IntentDefinition = {
  category: 'maintenance',
  priority: 'normal',
  mandatory: false,
  channels: ['push', 'email'],
  smsOnlyWithoutPush: false,
  title: 'notifications.account.security_alert.title',
  body: 'notifications.account.security_alert.body',
};

describe('resolveChannels', () => {
  it('drops channels the user turned off for optional intents', () => {
    expect(resolveChannels(optional, new Map([['maintenance:push', false]]))).toEqual(['email']);
  });

  it('ignores preferences for mandatory intents (SOS, security)', () => {
    const security = INTENTS['account.security_alert'];
    expect(
      resolveChannels(
        security,
        new Map([
          ['security:push', false],
          ['security:sms', false],
        ]),
      ),
    ).toEqual(['push', 'sms']);
  });
});

describe('estate notification templates', () => {
  it('locks safety-critical and platform intents from estate customisation', () => {
    expect(isCustomisableEstateIntent('emergency.sos')).toBe(false);
    expect(isCustomisableEstateIntent('emergency.sos_escalated')).toBe(false);
    expect(isCustomisableEstateIntent('emergency.broadcast')).toBe(false);
    expect(isCustomisableEstateIntent('account.security_alert')).toBe(false);
    expect(isCustomisableEstateIntent('visitor.arrived')).toBe(true);
    expect(isCustomisableEstateIntent('billing.invoice_issued')).toBe(true);
    expect(isCustomisableEstateIntent('unknown.intent')).toBe(false);
  });

  it('extracts unique placeholder names across templates', () => {
    expect(
      extractPlaceholders('Hello {name}', '{name} arrived at {gate}', null, undefined),
    ).toEqual(['name', 'gate']);
  });

  it('renders known placeholders and preserves unknown ones verbatim', () => {
    expect(
      renderTemplate('{visitor} checked in at {gate} ({extra})', {
        visitor: 'Ada',
        gate: 'Main Gate',
      }),
    ).toBe('Ada checked in at Main Gate ({extra})');
  });
});
