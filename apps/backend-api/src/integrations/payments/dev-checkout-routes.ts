import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { FakePaymentGateway } from './fake-payment.gateway';

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#FAF7F2;color:#2E3331}
main{max-width:420px;margin:0 auto;padding:24px 16px;display:grid;gap:16px}
.card{background:#fff;border:1px solid #F1ECE4;border-radius:12px;padding:20px;display:grid;gap:8px}
.tag{justify-self:start;background:#FDF1E3;color:#8A3F06;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600}
.amount{font-size:32px;font-weight:700}.muted{color:#646966;font-size:14px}
button,a.button{display:block;width:100%;min-height:48px;border-radius:8px;border:0;font-size:16px;font-weight:600;text-align:center;line-height:48px;text-decoration:none;cursor:pointer}
.pay{background:#254D42;color:#fff}.fail{background:#fff;color:#C81E1E;border:1px solid #C81E1E}
form{margin:0}
</style></head><body><main>${body}</main></body></html>`;
}

/**
 * A button back to where the payer came from: the app's own link (development builds) or a web page such as
 * the advertiser area. Expo Go users without a link switch back by hand.
 */
function returnLink(callbackUrl: string): string {
  return /^(safezone:|https?:\/\/)/i.test(callbackUrl)
    ? `<a class="button pay" href="${escapeHtml(callbackUrl)}">Return to Safezone</a>`
    : '';
}

/**
 * Test checkout for the fake payment provider (development only). The fake provider's checkout links
 * point here, so a payment started on a phone can be finished or failed by hand. The app then confirms
 * the result with the API (POST /payment-intents/:id/verify), exactly as with a real provider.
 * Mounted as plain Express routes so they never appear in the API contract.
 */
export function mountDevCheckout(app: INestApplication, gateway: unknown): boolean {
  if (!(gateway instanceof FakePaymentGateway) || !gateway.checkoutBaseUrl) return false;
  const express = app as NestExpressApplication;

  express.use('/dev-checkout/:reference', (request: Request, response: Response) => {
    const reference = String(request.params.reference ?? '');
    const checkout = gateway.checkout(reference);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!checkout) {
      response
        .status(404)
        .send(
          page(
            'Payment not found',
            '<div class="card"><h1>Payment not found</h1><p class="muted">Start the payment again from the app. Test payments are lost when the API restarts.</p></div>',
          ),
        );
      return;
    }
    const amount = naira.format(checkout.amountKobo / 100);
    const action = request.path.replace(/^\//, '');

    if (request.method === 'POST' && (action === 'pay' || action === 'fail')) {
      if (checkout.status === 'pending')
        gateway.complete(reference, action === 'fail' ? { status: 'failed' } : {});
      const paid = action === 'pay';
      response.send(
        page(
          paid ? 'Test payment done' : 'Test payment failed',
          `<div class="card"><span class="tag">Test checkout</span><h1>${paid ? 'Test payment done' : 'Test payment failed'}</h1>
<p class="muted">${paid ? `${amount} marked as paid.` : 'The payment was declined.'} Go back to the Safezone app; it confirms the result with the server.</p></div>
${returnLink(checkout.callbackUrl)}`,
        ),
      );
      return;
    }
    if (request.method !== 'GET') {
      response.status(405).end();
      return;
    }
    const done = checkout.status !== 'pending';
    response.send(
      page(
        'Test checkout',
        `<div class="card"><span class="tag">Test checkout, no real money</span>
<div class="muted">Amount</div><div class="amount">${escapeHtml(amount)}</div>
<div class="muted">Reference ${escapeHtml(reference)}</div></div>
${
  done
    ? `<div class="card"><p>This payment is already ${escapeHtml(checkout.status)}.</p></div>${returnLink(checkout.callbackUrl)}`
    : `<form method="post" action="/dev-checkout/${encodeURIComponent(reference)}/pay"><button class="pay" type="submit">Pay ${escapeHtml(amount)}</button></form>
<form method="post" action="/dev-checkout/${encodeURIComponent(reference)}/fail"><button class="fail" type="submit">Fail this payment</button></form>`
}`,
      ),
    );
  });
  return true;
}
