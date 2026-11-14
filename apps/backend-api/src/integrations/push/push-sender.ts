export interface PushMessage {
  /** ExponentPushToken[...] */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority: 'default' | 'high';
  /** Android channel; critical alerts use a high-importance channel in the apps. */
  channelId?: string;
}

export type PushTicket = { status: 'ok'; id: string } | { status: 'error'; error: string };
export type PushReceipt = { status: 'ok' } | { status: 'error'; error: string };

/** Push adapter: Expo Notifications only (AGENTS.md §6.1). Never log tokens. */
export abstract class PushSender {
  abstract isValidToken(token: string): boolean;
  /** One ticket per message, in order. */
  abstract send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  abstract receipts(ticketIds: readonly string[]): Promise<Record<string, PushReceipt>>;
}

export class FakePushSender extends PushSender {
  readonly sent: PushMessage[] = [];
  readonly receiptsById = new Map<string, PushReceipt>();

  isValidToken(token: string): boolean {
    return /^Expo(nent)?PushToken\[.+\]$/.test(token);
  }

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    return messages.map((message) => {
      this.sent.push(message);
      const id = `ticket-${this.sent.length}`;
      if (!this.receiptsById.has(id)) this.receiptsById.set(id, { status: 'ok' });
      return { status: 'ok' as const, id };
    });
  }

  async receipts(ticketIds: readonly string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(
      ticketIds.flatMap((id) =>
        this.receiptsById.has(id) ? [[id, this.receiptsById.get(id)!]] : [],
      ),
    );
  }
}
