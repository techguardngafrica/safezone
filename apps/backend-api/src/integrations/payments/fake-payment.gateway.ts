import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type InitializeInput,
  PaymentGateway,
  PaymentProviderError,
  type VerifiedCharge,
  type WebhookEvent,
} from './payment-gateway';

interface FakeCharge {
  input: InitializeInput;
  status: VerifiedCharge['status'];
  paidKobo: number;
  channel: string;
  customerCode: string | null;
}

/**
 * In-memory provider for tests and local development. `complete()` simulates the payer finishing
 * checkout; `transfer()` simulates a bank transfer into a dedicated account. Webhooks are signed with
 * HMAC-SHA512 like Paystack's, using a local secret.
 */
export class FakePaymentGateway extends PaymentGateway {
  readonly provider = 'fake' as const;
  readonly charges = new Map<string, FakeCharge>();
  readonly accounts = new Map<string, { accountNumber: string; subaccountCode: string }>();
  readonly refunds: { transactionReference: string; amountKobo: number }[] = [];
  private sequence = 0;

  /**
   * @param checkoutBaseUrl Development only: when set, checkout links open the API's test checkout page
   * (`/dev-checkout/<reference>`, see dev-checkout-routes.ts) so a payer can finish a fake payment.
   */
  constructor(
    readonly webhookSecret = 'fake-webhook-secret',
    readonly checkoutBaseUrl?: string,
  ) {
    super();
  }

  /** The pending checkout for a reference, for the test checkout page. */
  checkout(
    reference: string,
  ): { amountKobo: number; callbackUrl: string; status: VerifiedCharge['status'] } | null {
    const charge = this.charges.get(reference);
    if (!charge || charge.channel !== 'card') return null;
    return {
      amountKobo: charge.input.amountKobo,
      callbackUrl: charge.input.callbackUrl,
      status: charge.status,
    };
  }

  async initialize(input: InitializeInput) {
    if (input.subaccountCode !== null && !input.subaccountCode.startsWith('ACCT_fake_'))
      throw new PaymentProviderError('fake', false, 'Unknown subaccount');
    this.charges.set(input.reference, {
      input,
      status: 'pending',
      paidKobo: 0,
      channel: 'card',
      customerCode: null,
    });
    return {
      authorizationUrl: this.checkoutBaseUrl
        ? `${this.checkoutBaseUrl.replace(/\/$/, '')}/dev-checkout/${encodeURIComponent(input.reference)}`
        : `https://checkout.fake.local/${input.reference}`,
      reference: input.reference,
    };
  }

  /** Test helper: the payer paid (optionally a different amount, to test mismatches). */
  complete(
    reference: string,
    options: { amountKobo?: number; status?: VerifiedCharge['status'] } = {},
  ) {
    const charge = this.charges.get(reference);
    if (!charge) throw new Error(`no fake charge ${reference}`);
    charge.status = options.status ?? 'success';
    charge.paidKobo = options.amountKobo ?? charge.input.amountKobo;
  }

  /** Test helper: a bank transfer into a dedicated account. Returns the charge reference. */
  transfer(customerCode: string, amountKobo: number): string {
    const reference = `fake_dva_${++this.sequence}`;
    this.charges.set(reference, {
      input: {
        reference,
        amountKobo,
        email: '',
        subaccountCode: '',
        callbackUrl: '',
        metadata: {},
      },
      status: 'success',
      paidKobo: amountKobo,
      channel: 'dedicated_nuban',
      customerCode,
    });
    return reference;
  }

  async verify(reference: string): Promise<VerifiedCharge> {
    const charge = this.charges.get(reference);
    if (!charge) throw new PaymentProviderError('fake', false, 'Unknown reference');
    return {
      reference,
      status: charge.status,
      amountKobo: charge.paidKobo,
      currency: 'NGN',
      feesKobo: Math.min(Math.round(charge.paidKobo * 0.015), 200_000),
      channel: charge.channel,
      providerTransactionId: `fake_txn_${reference}`,
      paidAt: charge.status === 'success' ? new Date() : null,
      metadata: charge.input.metadata,
      customerCode: charge.customerCode,
    };
  }

  sign(rawBody: string): string {
    return createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex');
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const header = headers['x-fake-signature'];
    if (typeof header !== 'string') return false;
    const expected = Buffer.from(
      createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex'),
    );
    const given = Buffer.from(header);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  parseWebhook(body: unknown): WebhookEvent | null {
    const value = body as {
      id?: unknown;
      event?: unknown;
      data?: { reference?: unknown; customer?: unknown };
    };
    if (typeof value?.event !== 'string') return null;
    const reference = typeof value.data?.reference === 'string' ? value.data.reference : null;
    const type =
      value.event === 'charge.success' ||
      value.event === 'refund.processed' ||
      value.event === 'refund.failed'
        ? value.event
        : 'other';
    return {
      eventId: typeof value.id === 'string' ? value.id : `${value.event}:${reference ?? ''}`,
      type,
      reference,
      customerCode: typeof value.data?.customer === 'string' ? value.data.customer : null,
    };
  }

  async listBanks() {
    return [
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '044', name: 'Access Bank' },
      { code: '999', name: 'Fake Bank' },
    ];
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    if (accountNumber.startsWith('000'))
      throw new PaymentProviderError('fake', false, 'Account not found');
    const bank = (await this.listBanks()).find((item) => item.code === bankCode);
    if (!bank) throw new PaymentProviderError('fake', false, 'Unknown bank');
    return { accountName: 'ESTATE RESIDENTS ASSOCIATION', bankName: bank.name };
  }

  async createSubaccount(input: { businessName: string; bankCode: string; accountNumber: string }) {
    return { subaccountCode: `ACCT_fake_${input.accountNumber.slice(-4)}_${++this.sequence}` };
  }

  async createDedicatedAccount(input: {
    reference: string;
    fullName: string;
    subaccountCode: string;
  }) {
    const customerCode = `CUS_fake_${++this.sequence}`;
    const accountNumber = `99${String(this.sequence).padStart(8, '0')}`;
    this.accounts.set(customerCode, { accountNumber, subaccountCode: input.subaccountCode });
    return {
      customerCode,
      accountNumber,
      bankName: 'Fake Bank',
      accountName: `SAFEZONE/${input.fullName}`,
    };
  }

  async refund(input: { transactionReference: string; amountKobo: number }) {
    this.refunds.push(input);
    return { providerRef: `fake_refund_${++this.sequence}`, status: 'processing' as const };
  }
}
