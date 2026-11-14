import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Tx } from '../../common/database/tenant-context';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import type { IntentKey } from './domain/intents';

export const notificationRequestSchema = z.object({
  intent: z.string().min(3).max(80),
  userIds: z.array(z.uuid()).min(1).max(5000),
  estateId: z.uuid().nullable(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** One notification per user per key (retries and duplicate events do not re-notify). */
  dedupeKey: z.string().min(1).max(200),
});
export type NotificationRequest = z.infer<typeof notificationRequestSchema>;

/**
 * Public interface for other modules (notifications.md §5.1): request a notification inside your own
 * transaction. It is written to the outbox and delivered by the worker, so it never slows the request
 * and is never lost if the transaction commits.
 */
@Injectable()
export class NotificationsService {
  async request(
    tx: Tx,
    input: Omit<NotificationRequest, 'intent' | 'data'> & {
      intent: IntentKey;
      data?: NotificationRequest['data'];
    },
  ): Promise<void> {
    const request = notificationRequestSchema.parse(input);
    await appendOutboxEvents(tx, [
      {
        type: 'notifications.request.created',
        estateId: request.estateId,
        aggregateType: 'notification_request',
        aggregateId: request.dedupeKey,
        payload: request,
      },
    ]);
  }
}
