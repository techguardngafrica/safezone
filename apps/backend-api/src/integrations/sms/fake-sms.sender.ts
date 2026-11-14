import { Logger } from '@nestjs/common';
import { maskPhone } from '@safezone/auth';
import type { EmailSender } from '../email/email-sender';
import { SmsSender, type SmsMessage } from './sms-sender';

/**
 * Development and test SMS sender. Messages are kept in memory (tests read them) and, in development,
 * forwarded to the local Mailpit inbox (http://localhost:8025) so developers can read OTP codes.
 * Bodies are never logged. loadEnv() refuses this provider in staging and production.
 */
export class FakeSmsSender extends SmsSender {
  private readonly logger = new Logger('FakeSms');
  readonly sent: SmsMessage[] = [];

  constructor(private readonly mailbox?: EmailSender) {
    super();
  }

  async send(message: SmsMessage): Promise<{ providerRef: string | null }> {
    this.sent.push(message);
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`fake ${message.kind} sms to ${maskPhone(message.to)}`);
    if (this.mailbox) {
      await this.mailbox
        .send({
          to: 'sms-outbox@safezone.local',
          subject: `SMS to ${message.to}`,
          text: message.body,
        })
        .catch(() => this.logger.warn('could not forward fake sms to the local mailbox'));
    }
    return { providerRef: `fake-${this.sent.length}` };
  }

  /** Test helper: last message sent to a number. */
  lastTo(phone: string): SmsMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === phone);
  }
}
