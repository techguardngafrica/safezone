/**
 * Payment provider adapter (payments.md §2, AGENTS.md §5.7). Domain code depends on this class only.
 * Money is integer kobo. Implementations never log account numbers, card data or secrets.
 */
export type ProviderName = 'paystack' | 'flutterwave' | 'fake';

export interface InitializeInput {
  reference: string;
  amountKobo: number;
  /** Paystack requires an email; we pass the payer's or a per-user placeholder on our domain. */
  email: string;
  /**
   * Estate subaccount: all of the payment settles there (Safezone never holds estate money). Null only for
   * a platform charge, where Safezone sells its own service on its own account (ADR-0018).
   */
  subaccountCode: string | null;
  /**
   * Marketplace split (ADR-0023): the part of the charge that settles to Safezone's own account as its
   * commission; the rest settles to `subaccountCode` (the vendor or recipient). Zero or absent otherwise.
   */
  transactionChargeKobo?: number;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface VerifiedCharge {
  reference: string;
  status: 'success' | 'failed' | 'pending' | 'abandoned';
  amountKobo: number;
  currency: string;
  feesKobo: number;
  channel: string;
  providerTransactionId: string;
  paidAt: Date | null;
  metadata: Record<string, string>;
  /** Dedicated virtual account transfers: the provider's customer code. */
  customerCode: string | null;
}

export interface WebhookEvent {
  /** Stable id for de-duplication (provider event id, or type + reference). */
  eventId: string;
  type: 'charge.success' | 'refund.processed' | 'refund.failed' | 'other';
  reference: string | null;
  customerCode: string | null;
}

export class PaymentProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly retryable: boolean,
    message = 'Payment provider request failed',
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export abstract class PaymentGateway {
  abstract readonly provider: ProviderName;
  abstract initialize(
    input: InitializeInput,
  ): Promise<{ authorizationUrl: string; reference: string }>;
  abstract verify(reference: string): Promise<VerifiedCharge>;
  /** HMAC check of the raw request body against the provider's signature header. */
  abstract verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;
  abstract parseWebhook(body: unknown): WebhookEvent | null;
  abstract listBanks(): Promise<{ code: string; name: string }[]>;
  abstract resolveAccount(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ accountName: string; bankName: string }>;
  abstract createSubaccount(input: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<{ subaccountCode: string }>;
  abstract createDedicatedAccount(input: {
    reference: string;
    fullName: string;
    phone: string;
    email: string;
    subaccountCode: string;
  }): Promise<{
    customerCode: string;
    accountNumber: string;
    bankName: string;
    accountName: string;
  }>;
  abstract refund(input: { transactionReference: string; amountKobo: number }): Promise<{
    providerRef: string;
    status: 'processing' | 'completed' | 'failed';
  }>;
}
