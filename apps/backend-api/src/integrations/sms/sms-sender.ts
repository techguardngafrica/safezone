export interface SmsMessage {
  /** E.164 */
  to: string;
  body: string;
  /** otp uses the provider's OTP/DND route where available. */
  kind: 'otp' | 'transactional';
}

/** SMS adapter (backend-api.md §13). Never log the body: it can hold an OTP. */
export abstract class SmsSender {
  abstract send(message: SmsMessage): Promise<{ providerRef: string | null }>;
}

export class SmsDeliveryError extends Error {
  constructor(
    readonly provider: string,
    readonly retryable: boolean,
  ) {
    super(`SMS delivery failed (${provider})`);
    this.name = 'SmsDeliveryError';
  }
}
