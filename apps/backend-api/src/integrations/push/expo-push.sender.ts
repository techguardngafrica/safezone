import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { PushSender, type PushMessage, type PushReceipt, type PushTicket } from './push-sender';

/** Expo push service (delivers to FCM and APNs). Receipts are checked later by a worker job. */
export class ExpoPushSender extends PushSender {
  private readonly expo: Expo;

  constructor(accessToken?: string) {
    super();
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  isValidToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    const expoMessages: ExpoPushMessage[] = messages.map((message) => ({
      to: message.to,
      title: message.title,
      body: message.body,
      sound: 'default',
      priority: message.priority,
      ...(message.data ? { data: message.data } : {}),
      ...(message.channelId ? { channelId: message.channelId } : {}),
    }));
    for (const chunk of this.expo.chunkPushNotifications(expoMessages)) {
      try {
        const chunkTickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (const ticket of chunkTickets) {
          tickets.push(
            ticket.status === 'ok'
              ? { status: 'ok', id: ticket.id }
              : { status: 'error', error: ticket.details?.error ?? 'Unknown' },
          );
        }
      } catch {
        for (let i = 0; i < chunk.length; i += 1)
          tickets.push({ status: 'error', error: 'RequestFailed' });
      }
    }
    return tickets;
  }

  async receipts(ticketIds: readonly string[]): Promise<Record<string, PushReceipt>> {
    const result: Record<string, PushReceipt> = {};
    for (const chunk of this.expo.chunkPushNotificationReceiptIds([...ticketIds])) {
      const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(receipts)) {
        result[id] =
          receipt.status === 'ok'
            ? { status: 'ok' }
            : { status: 'error', error: receipt.details?.error ?? 'Unknown' };
      }
    }
    return result;
  }
}
