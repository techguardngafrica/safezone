import type { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountDevCheckout } from './dev-checkout-routes';
import { FakePaymentGateway } from './fake-payment.gateway';

const asNest = (app: express.Express) =>
  ({ use: app.use.bind(app) }) as unknown as INestApplication;

async function started(gateway: FakePaymentGateway, reference: string) {
  const app = express();
  mountDevCheckout(asNest(app), gateway);
  const checkout = await gateway.initialize({
    reference,
    amountKobo: 1_250_000,
    email: 'u@payers.safezone.ng',
    subaccountCode: 'ACCT_fake_1234_1',
    callbackUrl: 'safezone://pay/return',
    metadata: {},
  });
  return { app, checkout };
}

describe('dev checkout', () => {
  it('points checkout links at the test page and completes a payment', async () => {
    const gateway = new FakePaymentGateway(undefined, 'http://192.168.0.10:4000');
    const { app, checkout } = await started(gateway, 'sz_ref1');
    expect(checkout.authorizationUrl).toBe('http://192.168.0.10:4000/dev-checkout/sz_ref1');

    const pageResponse = await request(app).get('/dev-checkout/sz_ref1').expect(200);
    expect(pageResponse.text).toContain('12,500.00');
    expect((await gateway.verify('sz_ref1')).status).toBe('pending');

    const done = await request(app).post('/dev-checkout/sz_ref1/pay').expect(200);
    expect(done.text).toContain('safezone://pay/return');
    expect(await gateway.verify('sz_ref1')).toMatchObject({
      status: 'success',
      amountKobo: 1_250_000,
    });
  });

  it('can fail a payment instead', async () => {
    const gateway = new FakePaymentGateway(undefined, 'http://localhost:4000');
    const { app } = await started(gateway, 'sz_ref2');
    await request(app).post('/dev-checkout/sz_ref2/fail').expect(200);
    expect((await gateway.verify('sz_ref2')).status).toBe('failed');
  });

  it('answers 404 for an unknown reference', async () => {
    const gateway = new FakePaymentGateway(undefined, 'http://localhost:4000');
    const { app } = await started(gateway, 'sz_ref3');
    await request(app).get('/dev-checkout/nope').expect(404);
  });

  it('is not mounted without a checkout address (tests, staging, production)', () => {
    expect(mountDevCheckout(asNest(express()), new FakePaymentGateway())).toBe(false);
  });
});
