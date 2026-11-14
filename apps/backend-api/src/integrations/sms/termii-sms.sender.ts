import { SmsDeliveryError, SmsSender, type SmsMessage } from './sms-sender';

interface TermiiOptions {
  apiKey: string;
  senderId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Termii SMS (https://developers.termii.com). OTPs go on the `dnd` channel so they reach numbers on
 * Do-Not-Disturb; that route needs an approved sender ID.
 */
export class TermiiSmsSender extends SmsSender {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TermiiOptions) {
    super();
    this.baseUrl = options.baseUrl ?? 'https://api.ng.termii.com';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(message: SmsMessage): Promise<{ providerRef: string | null }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          to: message.to.replace(/^\+/, ''),
          from: this.options.senderId,
          sms: message.body,
          type: 'plain',
          channel: message.kind === 'otp' ? 'dnd' : 'generic',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new SmsDeliveryError('termii', true);
    }
    if (!response.ok)
      throw new SmsDeliveryError('termii', response.status >= 500 || response.status === 429);
    const body = (await response.json().catch(() => ({}))) as { message_id?: unknown };
    return { providerRef: typeof body.message_id === 'string' ? body.message_id : null };
  }
}
