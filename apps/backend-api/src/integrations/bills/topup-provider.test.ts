import { afterEach, describe, expect, it, vi } from 'vitest';
import { localPhone, mapVtpass, VtpassTopUpProvider, vtpassRequestId } from './topup-provider';

describe('VTpass rules', () => {
  it('builds request ids from the Lagos date and time', () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    expect(
      vtpassRequestId('0193a1b2-0000-7000-8000-00000000ab01', new Date('2026-11-22T23:30:00Z')),
    ).toBe('2026112300300193a1b2000070008000');
  });

  it('turns E.164 numbers into local numbers', () => {
    expect(localPhone('+2348031234567')).toBe('08031234567');
  });

  it('maps codes and statuses', () => {
    expect(
      mapVtpass({
        code: '000',
        content: { transactions: { status: 'delivered', transactionId: 17 } },
      }),
    ).toEqual({
      status: 'delivered',
      providerRef: '17',
    });
    expect(
      mapVtpass({ code: '000', content: { transactions: { status: 'initiated' } } }).status,
    ).toBe('pending');
    expect(mapVtpass({ code: '099' }).status).toBe('pending');
    expect(mapVtpass({ code: '016' }).status).toBe('failed');
    expect(mapVtpass({ code: '040' }).status).toBe('failed');
    expect(mapVtpass({ code: '999' }).status).toBe('pending');
    expect(mapVtpass({}).status).toBe('pending');
  });
});

describe('VtpassTopUpProvider', () => {
  const provider = new VtpassTopUpProvider({
    baseUrl: 'https://sandbox.vtpass.com/api',
    apiKey: 'k',
    secretKey: 'SK_x',
    publicKey: 'PK_x',
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends airtime with POST keys and a local number, and requeries a duplicate request id', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      { code: '014' },
      { code: '000', content: { transactions: { status: 'delivered', transactionId: 9 } } },
    ];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(answers.shift()), { status: 200 });
    });
    const result = await provider.airtime({
      requestId: '202611221830abc',
      network: '9mobile',
      phone: '+2348031234567',
      amountKobo: 50_000,
    });
    expect(result).toEqual({ status: 'delivered', providerRef: '9' });
    expect(calls[0]?.url).toBe('https://sandbox.vtpass.com/api/pay');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      request_id: '202611221830abc',
      serviceID: 'etisalat',
      amount: 500,
      phone: '08031234567',
    });
    expect((calls[0]?.init.headers as Record<string, string>)['secret-key']).toBe('SK_x');
    expect(calls[1]?.url).toBe('https://sandbox.vtpass.com/api/requery');
  });

  it('treats no answer as pending, and refused requests as failed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('timeout');
    });
    expect(
      (
        await provider.airtime({
          requestId: 'r1',
          network: 'mtn',
          phone: '+2348031234567',
          amountKobo: 10_000,
        })
      ).status,
    ).toBe('pending');
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ code: '018' }), { status: 200 }),
    );
    expect(
      (
        await provider.airtime({
          requestId: 'r2',
          network: 'mtn',
          phone: '+2348031234567',
          amountKobo: 10_000,
        })
      ).status,
    ).toBe('failed');
  });

  it('lists data plans with GET keys, skipping a repeated code', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          content: {
            variations: [
              { variation_code: 'mtn-10mb-100', name: 'N100 100MB', variation_amount: '100.00' },
              { variation_code: 'mtn-xtratalk-300', name: 'Weekly', variation_amount: '300.00' },
              { variation_code: 'mtn-xtratalk-300', name: '3 days', variation_amount: '200.00' },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const plans = await provider.dataPlans('mtn');
    expect(plans).toEqual([
      { code: 'mtn-10mb-100', name: 'N100 100MB', amountKobo: 10_000 },
      { code: 'mtn-xtratalk-300', name: 'Weekly', amountKobo: 30_000 },
    ]);
    expect(headers['public-key']).toBe('PK_x');
  });
});
