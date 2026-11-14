import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@safezone/auth';
import { type Locale, SUPPORTED_LOCALES, t } from '@safezone/i18n';
import { DatabaseService } from '../../common/database/database.service';
import type { RelayedEvent } from '../../common/outbox/outbox-relay';
import { PushSender } from '../../integrations/push/push-sender';
import { SmsSender } from '../../integrations/sms/sms-sender';
import { INTENTS, isIntentKey, resolveChannels } from './domain/intents';
import { type NotificationRequest, notificationRequestSchema } from './notifications.service';

/** Domain events that become notifications without the emitting module calling us. */
export function requestFromEvent(event: RelayedEvent): NotificationRequest | null {
  if (event.type === 'notifications.request.created') {
    return notificationRequestSchema.parse(event.payload);
  }
  if (event.type === 'identity.refresh.reuse_detected') {
    const payload = event.payload as { userId?: unknown };
    if (typeof payload.userId !== 'string') return null;
    return {
      intent: 'account.security_alert',
      userIds: [payload.userId],
      estateId: null,
      data: {},
      dedupeKey: `event:${event.id}`,
    };
  }
  return null;
}

const RECEIPT_MIN_AGE_MS = 60_000;
const RECEIPT_MAX_AGE_MS = 24 * 3600_000;

/**
 * Worker side of notifications (notifications.md §5): in-app record, channel resolution, rendering,
 * provider sends and delivery tracking. Idempotent per (user, dedupeKey).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushSender,
    private readonly sms: SmsSender,
  ) {}

  async deliver(request: NotificationRequest): Promise<void> {
    if (!isIntentKey(request.intent)) {
      this.logger.warn({ msg: 'unknown intent', intent: request.intent });
      return;
    }
    const intent = INTENTS[request.intent];
    for (const userId of request.userIds) {
      await this.deliverToUser(request, intent, userId);
    }
  }

  private async deliverToUser(
    request: NotificationRequest,
    intent: (typeof INTENTS)[keyof typeof INTENTS],
    userId: string,
  ): Promise<void> {
    const prepared = await this.db.withContext('notifications', async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { phoneE164: true, locale: true, status: true },
      });
      if (!user || user.status === 'deleted') return null;
      const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(user.locale)
        ? (user.locale as Locale)
        : 'en';
      const params = Object.fromEntries(
        Object.entries(request.data).map(([key, value]) => [key, String(value)]),
      );

      await tx.notification.createMany({
        data: [
          {
            userId,
            estateId: request.estateId,
            intentKey: request.intent,
            priority: intent.priority,
            title: t(intent.title, params, locale),
            body: t(intent.body, params, locale),
            data: request.data,
            dedupeKey: request.dedupeKey,
          },
        ],
        skipDuplicates: true,
      });
      const notification = await tx.notification.findUniqueOrThrow({
        where: { userId_dedupeKey: { userId, dedupeKey: request.dedupeKey } },
        include: { deliveries: { select: { id: true } } },
      });
      if (notification.deliveries.length > 0) return null; // already delivered (duplicate job)

      const preferences = await tx.notificationPreference.findMany({ where: { userId } });
      const tokens = await tx.pushToken.findMany({
        where: { userId, invalidAt: null },
        select: { id: true, expoToken: true },
      });
      return {
        notification,
        phone: user.phoneE164,
        smsText: intent.sms ? t(intent.sms, params, locale) : notification.body,
        tokens,
        channels: resolveChannels(
          intent,
          new Map(preferences.map((p) => [`${p.category}:${p.channel}`, p.enabled])),
        ),
      };
    });
    if (!prepared) return;

    const { notification, channels, tokens } = prepared;
    const deliveries: {
      channel: string;
      provider: string;
      toAddress: string;
      status: string;
      providerRef: string | null;
      error: string | null;
      sentAt: Date | null;
    }[] = [];
    const invalidTokenIds: string[] = [];
    let pushAccepted = false;

    if (channels.includes('push') && tokens.length > 0) {
      const valid = tokens.filter((token) => this.push.isValidToken(token.expoToken));
      const tickets = await this.push.send(
        valid.map((token) => ({
          to: token.expoToken,
          title: notification.title,
          body: notification.body,
          data: { notificationId: notification.id, intent: notification.intentKey },
          priority:
            intent.priority === 'critical' || intent.priority === 'high' ? 'high' : 'default',
          channelId: intent.priority === 'critical' ? 'critical' : 'default',
        })),
      );
      valid.forEach((token, index) => {
        const ticket = tickets[index];
        const ok = ticket?.status === 'ok';
        pushAccepted ||= ok;
        if (ticket?.status === 'error' && ticket.error === 'DeviceNotRegistered')
          invalidTokenIds.push(token.id);
        deliveries.push({
          channel: 'push',
          provider: 'expo',
          toAddress: token.id,
          status: ok ? 'sent' : 'failed',
          providerRef: ticket?.status === 'ok' ? ticket.id : null,
          error: ticket?.status === 'error' ? ticket.error : null,
          sentAt: ok ? new Date() : null,
        });
      });
    }

    if (channels.includes('sms') && (!intent.smsOnlyWithoutPush || !pushAccepted)) {
      try {
        const result = await this.sms.send({
          to: prepared.phone,
          body: prepared.smsText,
          kind: 'transactional',
        });
        deliveries.push({
          channel: 'sms',
          provider: 'sms',
          toAddress: maskPhone(prepared.phone),
          status: 'sent',
          providerRef: result.providerRef,
          error: null,
          sentAt: new Date(),
        });
      } catch {
        deliveries.push({
          channel: 'sms',
          provider: 'sms',
          toAddress: maskPhone(prepared.phone),
          status: 'failed',
          providerRef: null,
          error: 'send_failed',
          sentAt: null,
        });
      }
    }

    await this.db.withContext('notifications', async (tx) => {
      // In-app always counts as a delivery so a duplicate job is recognised even with no other channel.
      await tx.notificationDelivery.createMany({
        data: [
          {
            notificationId: notification.id,
            channel: 'in_app',
            provider: 'safezone',
            toAddress: userId,
            status: 'delivered',
            sentAt: new Date(),
            deliveredAt: new Date(),
          },
          ...deliveries.map((delivery) => ({ notificationId: notification.id, ...delivery })),
        ],
      });
      if (invalidTokenIds.length > 0) {
        await tx.pushToken.updateMany({
          where: { id: { in: invalidTokenIds } },
          data: { invalidAt: new Date() },
        });
      }
    });
  }

  /** Expo push receipts (notifications.md §9): marks deliveries and drops tokens Expo reports as dead. */
  async checkPushReceipts(now: Date = new Date()): Promise<number> {
    const pending = await this.db.withContext('notifications', (tx) =>
      tx.notificationDelivery.findMany({
        where: {
          channel: 'push',
          status: 'sent',
          providerRef: { not: null },
          sentAt: {
            lt: new Date(now.getTime() - RECEIPT_MIN_AGE_MS),
            gt: new Date(now.getTime() - RECEIPT_MAX_AGE_MS),
          },
        },
        select: { id: true, providerRef: true, toAddress: true },
        take: 1000,
      }),
    );
    if (pending.length === 0) return 0;
    const receipts = await this.push.receipts(
      pending.flatMap((delivery) => (delivery.providerRef ? [delivery.providerRef] : [])),
    );

    await this.db.withContext('notifications', async (tx) => {
      for (const delivery of pending) {
        const receipt = delivery.providerRef ? receipts[delivery.providerRef] : undefined;
        if (!receipt) continue;
        if (receipt.status === 'ok') {
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: 'delivered', deliveredAt: now },
          });
        } else {
          await tx.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: 'failed', error: receipt.error },
          });
          if (receipt.error === 'DeviceNotRegistered') {
            await tx.pushToken.updateMany({
              where: { id: delivery.toAddress },
              data: { invalidAt: now },
            });
          }
        }
      }
    });
    return Object.keys(receipts).length;
  }
}
