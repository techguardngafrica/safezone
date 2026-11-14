import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@safezone/auth';
import { t } from '@safezone/i18n';
import { DatabaseService } from '../../common/database/database.service';
import { EmailSender } from '../../integrations/email/email-sender';
import { SmsSender } from '../../integrations/sms/sms-sender';
import { CONTACT_INTENTS, type ContactIntentKey } from './domain/intents';

export interface ContactMessage {
  intent: ContactIntentKey;
  phone?: string | null;
  email?: string | null;
  data: Record<string, string>;
  /** Each channel is sent at most once per key. */
  dedupeKey: string;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Worker-side sends to a phone or email that may not belong to a user yet (invitations). Callers pass
 * rendered parameters directly, so secrets such as invitation links never touch the outbox or the
 * database. Idempotent: a channel is claimed in contact_deliveries before sending; a claimed but failed
 * send is retried by the job, a sent one never again.
 */
@Injectable()
export class ContactDeliveryService {
  private readonly logger = new Logger('ContactDelivery');

  constructor(
    private readonly db: DatabaseService,
    private readonly sms: SmsSender,
    private readonly email: EmailSender,
  ) {}

  async deliver(message: ContactMessage): Promise<void> {
    const intent = CONTACT_INTENTS[message.intent];
    const failures: string[] = [];
    if (message.phone) {
      const phone = message.phone;
      const ok = await this.once(message, 'sms', maskPhone(phone), () =>
        this.sms.send({ to: phone, body: t(intent.sms, message.data), kind: 'transactional' }),
      );
      if (!ok) failures.push('sms');
    }
    if (message.email) {
      const email = message.email;
      const ok = await this.once(message, 'email', maskEmail(email), () =>
        this.email.send({
          to: email,
          subject: t(intent.emailSubject, message.data),
          text: t(intent.emailBody, message.data),
        }),
      );
      if (!ok) failures.push('email');
    }
    // Retry the job only when nothing reached the person.
    const attempted = Number(Boolean(message.phone)) + Number(Boolean(message.email));
    if (attempted > 0 && failures.length === attempted) {
      throw new Error(`contact delivery failed: ${failures.join(', ')}`);
    }
  }

  /** Returns false when the send failed. */
  private async once(
    message: ContactMessage,
    channel: 'sms' | 'email',
    toAddress: string,
    send: () => Promise<{ providerRef: string | null }>,
  ): Promise<boolean> {
    const existing = await this.db.withContext('notifications', async (tx) => {
      await tx.contactDelivery.createMany({
        data: [{ dedupeKey: message.dedupeKey, intentKey: message.intent, channel, toAddress }],
        skipDuplicates: true,
      });
      return tx.contactDelivery.findUniqueOrThrow({
        where: { dedupeKey_channel: { dedupeKey: message.dedupeKey, channel } },
      });
    });
    if (existing.status === 'sent') return true;
    try {
      const result = await send();
      await this.db.withContext('notifications', (tx) =>
        tx.contactDelivery.update({
          where: { id: existing.id },
          data: {
            status: 'sent',
            providerRef: result.providerRef,
            sentAt: new Date(),
            error: null,
          },
        }),
      );
      return true;
    } catch (error) {
      this.logger.warn({ msg: 'contact send failed', channel, intent: message.intent });
      await this.db.withContext('notifications', (tx) =>
        tx.contactDelivery.update({
          where: { id: existing.id },
          data: { status: 'failed', error: error instanceof Error ? error.name : 'send_failed' },
        }),
      );
      return false;
    }
  }
}
