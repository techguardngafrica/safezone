import { describe, expect, it } from 'vitest';
import { INTENTS, resolveChannels, type IntentDefinition } from './intents';

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
