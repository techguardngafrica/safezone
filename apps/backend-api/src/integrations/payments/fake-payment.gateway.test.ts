import { describe, expect, it } from 'vitest';
import { FakePaymentGateway } from './fake-payment.gateway';
import { PaymentProviderError } from './payment-gateway';

const base = {
  email: 'payer@payers.safezone.ng',
  callbackUrl: 'https://safezone.ng/return',
  metadata: {},
};

describe('FakePaymentGateway split charges (ADR-0023)', () => {
  it('accepts a commission below the amount on a subaccount charge', async () => {
    const gateway = new FakePaymentGateway();
    await gateway.initialize({
      ...base,
      reference: 'sz_mkt_1',
      amountKobo: 100_000,
      subaccountCode: 'ACCT_fake_vendor',
      transactionChargeKobo: 5_000,
    });
    expect(gateway.charges.get('sz_mkt_1')?.input.transactionChargeKobo).toBe(5_000);
  });

  it('refuses a commission at or above the amount, or without a subaccount', async () => {
    const gateway = new FakePaymentGateway();
    await expect(
      gateway.initialize({
        ...base,
        reference: 'sz_mkt_2',
        amountKobo: 100_000,
        subaccountCode: 'ACCT_fake_vendor',
        transactionChargeKobo: 100_000,
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    await expect(
      gateway.initialize({
        ...base,
        reference: 'sz_mkt_3',
        amountKobo: 100_000,
        subaccountCode: null,
        transactionChargeKobo: 1,
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });
});
