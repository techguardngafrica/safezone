import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type InitializeInput,
  PaymentGateway,
  PaymentProviderError,
  type VerifiedCharge,
  type WebhookEvent,
} from './payment-gateway';

interface PaystackOptions {
  secretKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

/**
 * Paystack (https://paystack.com/docs/api). Checkout settles to the estate subaccount with
 * `bearer: subaccount` and no Safezone charge (payments.md §3.6). Webhooks are HMAC-SHA512 of the raw
 * body with the secret key, in `x-paystack-signature`.
 */
export class PaystackPaymentGateway extends PaymentGateway {
  readonly provider = 'paystack' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PaystackOptions) {
    super();
    this.baseUrl = options.baseUrl ?? 'https://api.paystack.co';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PaymentProviderError('paystack', true);
    }
    const parsed = (await response.json().catch(() => ({}))) as PaystackEnvelope<T>;
    if (!response.ok || parsed.status !== true || parsed.data === undefined) {
      throw new PaymentProviderError(
        'paystack',
        response.status >= 500 || response.status === 429,
        // Paystack messages are generic ("Invalid key", "Transaction reference not found"); never PII.
        typeof parsed.message === 'string' ? parsed.message.slice(0, 200) : undefined,
      );
    }
    return parsed.data;
  }

  async initialize(input: InitializeInput) {
    const data = await this.call<{ authorization_url: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      {
        reference: input.reference,
        amount: input.amountKobo,
        currency: 'NGN',
        email: input.email,
        subaccount: input.subaccountCode,
        bearer: 'subaccount',
        transaction_charge: 0,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      },
    );
    return { authorizationUrl: data.authorization_url, reference: data.reference };
  }

  async verify(reference: string): Promise<VerifiedCharge> {
    const data = await this.call<{
      id: number;
      status: string;
      reference: string;
      amount: number;
      currency: string;
      fees: number | null;
      channel: string;
      paid_at: string | null;
      metadata: Record<string, unknown> | string | null;
      customer?: { customer_code?: string };
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const metadata =
      data.metadata && typeof data.metadata === 'object'
        ? Object.fromEntries(
            Object.entries(data.metadata).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};
    const status = ['success', 'failed', 'abandoned'].includes(data.status)
      ? (data.status as VerifiedCharge['status'])
      : 'pending';
    return {
      reference: data.reference,
      status,
      amountKobo: data.amount,
      currency: data.currency,
      feesKobo: data.fees ?? 0,
      channel: data.channel,
      providerTransactionId: String(data.id),
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      metadata,
      customerCode: data.customer?.customer_code ?? null,
    };
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const header = headers['x-paystack-signature'];
    if (typeof header !== 'string') return false;
    const expected = Buffer.from(
      createHmac('sha512', this.options.secretKey).update(rawBody).digest('hex'),
    );
    const given = Buffer.from(header);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  parseWebhook(body: unknown): WebhookEvent | null {
    const value = body as {
      event?: unknown;
      data?: {
        id?: unknown;
        reference?: unknown;
        customer?: { customer_code?: unknown };
        transaction_reference?: unknown;
      };
    };
    if (typeof value?.event !== 'string') return null;
    const reference =
      typeof value.data?.reference === 'string'
        ? value.data.reference
        : typeof value.data?.transaction_reference === 'string'
          ? value.data.transaction_reference
          : null;
    const type =
      value.event === 'charge.success' ||
      value.event === 'refund.processed' ||
      value.event === 'refund.failed'
        ? value.event
        : 'other';
    const id = value.data?.id;
    return {
      eventId: `${value.event}:${typeof id === 'number' || typeof id === 'string' ? id : (reference ?? '')}`,
      type,
      reference,
      customerCode:
        typeof value.data?.customer?.customer_code === 'string'
          ? value.data.customer.customer_code
          : null,
    };
  }

  async listBanks() {
    const data = await this.call<{ code: string; name: string; active: boolean }[]>(
      'GET',
      '/bank?country=nigeria&currency=NGN',
    );
    return data.filter((bank) => bank.active).map((bank) => ({ code: bank.code, name: bank.name }));
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const data = await this.call<{ account_name: string }>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    const bank = (await this.listBanks()).find((item) => item.code === bankCode);
    return { accountName: data.account_name, bankName: bank?.name ?? bankCode };
  }

  async createSubaccount(input: { businessName: string; bankCode: string; accountNumber: string }) {
    const data = await this.call<{ subaccount_code: string }>('POST', '/subaccount', {
      business_name: input.businessName,
      settlement_bank: input.bankCode,
      account_number: input.accountNumber,
      percentage_charge: 0,
    });
    return { subaccountCode: data.subaccount_code };
  }

  async createDedicatedAccount(input: {
    reference: string;
    fullName: string;
    phone: string;
    email: string;
    subaccountCode: string;
  }) {
    const [firstName, ...rest] = input.fullName.split(' ');
    const customer = await this.call<{ customer_code: string }>('POST', '/customer', {
      email: input.email,
      first_name: firstName,
      last_name: rest.join(' ') || firstName,
      phone: input.phone,
      metadata: { reference: input.reference },
    });
    const account = await this.call<{
      account_number: string;
      account_name: string;
      bank: { name: string };
    }>('POST', '/dedicated_account', {
      customer: customer.customer_code,
      subaccount: input.subaccountCode,
    });
    return {
      customerCode: customer.customer_code,
      accountNumber: account.account_number,
      bankName: account.bank.name,
      accountName: account.account_name,
    };
  }

  async refund(input: { transactionReference: string; amountKobo: number }) {
    const data = await this.call<{ id: number; status: string }>('POST', '/refund', {
      transaction: input.transactionReference,
      amount: input.amountKobo,
    });
    return {
      providerRef: String(data.id),
      status: (data.status === 'processed'
        ? 'completed'
        : data.status === 'failed'
          ? 'failed'
          : 'processing') as 'processing' | 'completed' | 'failed',
    };
  }
}
