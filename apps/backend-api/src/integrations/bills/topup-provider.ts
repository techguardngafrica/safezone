/**
 * Airtime and data adapter (ADR-0025, AGENTS.md §5.7). Domain code depends on TopUpProvider only. Money is
 * integer kobo. Implementations never log phone numbers in full.
 */
export type Network = 'mtn' | 'glo' | 'airtel' | '9mobile';

export interface DataPlan {
  code: string;
  name: string;
  amountKobo: number;
}

/** delivered: done. pending: ask again later (requery). failed: not delivered, safe to refund. */
export interface TopUpResult {
  status: 'delivered' | 'pending' | 'failed';
  providerRef: string | null;
  reason?: string;
}

export class TopUpProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    message = 'Top-up provider request failed',
  ) {
    super(message);
    this.name = 'TopUpProviderError';
  }
}

export abstract class TopUpProvider {
  abstract readonly name: string;
  /** False until a provider is configured: purchases must not be taken. */
  abstract readonly available: boolean;
  abstract dataPlans(network: Network): Promise<DataPlan[]>;
  /** Idempotent on requestId: the provider refuses a reused id, and requery resolves it. */
  abstract airtime(input: {
    requestId: string;
    network: Network;
    phone: string;
    amountKobo: number;
  }): Promise<TopUpResult>;
  abstract data(input: {
    requestId: string;
    network: Network;
    phone: string;
    planCode: string;
  }): Promise<TopUpResult>;
  abstract requery(requestId: string): Promise<TopUpResult>;
}

/** Lagos date and time prefix VTpass requires on request ids (YYYYMMDDHHII, GMT+1). */
export function vtpassRequestId(purchaseId: string, at: Date): string {
  const lagos = new Date(at.getTime() + 3_600_000).toISOString();
  const prefix = lagos.slice(0, 16).replace(/[-T:]/g, '');
  return `${prefix}${purchaseId.replace(/-/g, '').slice(0, 20)}`;
}

/** +2348031234567 → 08031234567 (VTpass takes local numbers). */
export function localPhone(e164: string): string {
  return e164.startsWith('+234') ? `0${e164.slice(4)}` : e164;
}

const AIRTIME_SERVICE: Record<Network, string> = {
  mtn: 'mtn',
  glo: 'glo',
  airtel: 'airtel',
  '9mobile': 'etisalat',
};
const DATA_SERVICE: Record<Network, string> = {
  mtn: 'mtn-data',
  glo: 'glo-data',
  airtel: 'airtel-data',
  '9mobile': 'etisalat-data',
};

interface VtpassResponse {
  code?: string;
  response_description?: string;
  requestId?: string;
  content?: {
    transactions?: { status?: string; transactionId?: string | number };
    variations?: { variation_code?: string; name?: string; variation_amount?: string | number }[];
  };
}

/**
 * Maps a VTpass pay or requery answer (documentation, Nov 2026): 000 + delivered is success; 000 with
 * initiated or pending, 099 and anything unclear is pending (requery); 016, 040 and 091 are failures.
 */
export function mapVtpass(body: VtpassResponse): TopUpResult {
  const providerRef =
    body.content?.transactions?.transactionId !== undefined
      ? String(body.content.transactions.transactionId)
      : null;
  const code = body.code ?? '';
  if (code === '000') {
    const status = body.content?.transactions?.status;
    if (status === 'delivered') return { status: 'delivered', providerRef };
    if (status === 'failed' || status === 'reversed')
      return { status: 'failed', providerRef, reason: status };
    return { status: 'pending', providerRef };
  }
  if (code === '016' || code === '040' || code === '091')
    return { status: 'failed', providerRef, reason: `vtpass_${code}` };
  return { status: 'pending', providerRef, reason: code ? `vtpass_${code}` : 'no_code' };
}

/** Codes that mean the request itself was wrong or the account cannot sell: nothing was charged. */
const REQUEST_REFUSED = new Set([
  '010',
  '011',
  '012',
  '013',
  '017',
  '018',
  '027',
  '028',
  '030',
  '085',
  '087',
]);

export class VtpassTopUpProvider extends TopUpProvider {
  readonly name = 'vtpass';
  readonly available = true;
  private readonly plans = new Map<Network, { at: number; plans: DataPlan[] }>();

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      secretKey: string;
      publicKey: string;
    },
  ) {
    super();
  }

  async dataPlans(network: Network): Promise<DataPlan[]> {
    const cached = this.plans.get(network);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.plans;
    const body = await this.call('GET', `/service-variations?serviceID=${DATA_SERVICE[network]}`);
    const seen = new Set<string>();
    const plans: DataPlan[] = [];
    for (const item of body.content?.variations ?? []) {
      const code = item.variation_code;
      const amount = Number(item.variation_amount);
      // The same code can appear twice with different prices; keep the first and skip the rest.
      if (!code || !item.name || !Number.isFinite(amount) || amount <= 0 || seen.has(code))
        continue;
      seen.add(code);
      plans.push({ code, name: item.name, amountKobo: Math.round(amount * 100) });
    }
    this.plans.set(network, { at: Date.now(), plans });
    return plans;
  }

  async airtime(input: { requestId: string; network: Network; phone: string; amountKobo: number }) {
    return this.pay({
      request_id: input.requestId,
      serviceID: AIRTIME_SERVICE[input.network],
      amount: Math.round(input.amountKobo / 100),
      phone: localPhone(input.phone),
    });
  }

  async data(input: { requestId: string; network: Network; phone: string; planCode: string }) {
    return this.pay({
      request_id: input.requestId,
      serviceID: DATA_SERVICE[input.network],
      billersCode: localPhone(input.phone),
      variation_code: input.planCode,
      phone: localPhone(input.phone),
    });
  }

  async requery(requestId: string): Promise<TopUpResult> {
    const body = await this.call('POST', '/requery', { request_id: requestId });
    if (body.code === '015') return { status: 'failed', providerRef: null, reason: 'vtpass_015' };
    return mapVtpass(body);
  }

  private async pay(payload: Record<string, unknown>): Promise<TopUpResult> {
    let body: VtpassResponse;
    try {
      body = await this.call('POST', '/pay', payload);
    } catch (error) {
      // Timeout or no answer: VTpass says treat as pending and requery.
      if (error instanceof TopUpProviderError && error.retryable)
        return { status: 'pending', providerRef: null, reason: 'no_response' };
      throw error;
    }
    if (body.code === '014' || body.code === '019' || body.code === '089')
      return this.requery(String(payload.request_id));
    if (body.code && REQUEST_REFUSED.has(body.code))
      return { status: 'failed', providerRef: null, reason: `vtpass_${body.code}` };
    return mapVtpass(body);
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<VtpassResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'api-key': this.options.apiKey,
          ...(method === 'GET'
            ? { 'public-key': this.options.publicKey }
            : { 'secret-key': this.options.secretKey, 'content-type': 'application/json' }),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new TopUpProviderError(true, 'VTpass did not answer');
    }
    if (response.status >= 500)
      throw new TopUpProviderError(true, `VTpass error ${response.status}`);
    const parsed = (await response.json().catch(() => ({}))) as VtpassResponse;
    if (response.status >= 400 && !parsed.code)
      throw new TopUpProviderError(false, `VTpass refused the request (${response.status})`);
    return parsed;
  }
}

/** Where no provider is configured: never pretends to sell. */
export class UnconfiguredTopUpProvider extends TopUpProvider {
  readonly name = 'none';
  readonly available = false;
  async dataPlans(): Promise<DataPlan[]> {
    return [];
  }
  async airtime(): Promise<TopUpResult> {
    throw new TopUpProviderError(false, 'Airtime is not available yet');
  }
  async data(): Promise<TopUpResult> {
    throw new TopUpProviderError(false, 'Data is not available yet');
  }
  async requery(): Promise<TopUpResult> {
    return { status: 'failed', providerRef: null, reason: 'unconfigured' };
  }
}

/**
 * Deterministic fake (local and tests), mirroring VTpass's sandbox numbers: 08011111111 delivers, numbers
 * ending 0000 fail, numbers ending 9999 stay pending until `settle()`.
 */
export class FakeTopUpProvider extends TopUpProvider {
  readonly name = 'fake';
  readonly available = true;
  readonly requests = new Map<string, TopUpResult & { phone: string; amountKobo: number }>();

  async dataPlans(network: Network): Promise<DataPlan[]> {
    return [
      { code: `${network}-100mb-100`, name: '100MB, 1 day', amountKobo: 10_000 },
      { code: `${network}-1gb-500`, name: '1GB, 7 days', amountKobo: 50_000 },
      { code: `${network}-5gb-2000`, name: '5GB, 30 days', amountKobo: 200_000 },
    ];
  }

  async airtime(input: { requestId: string; network: Network; phone: string; amountKobo: number }) {
    return this.record(input.requestId, input.phone, input.amountKobo);
  }

  async data(input: { requestId: string; network: Network; phone: string; planCode: string }) {
    const plan = (await this.dataPlans(input.network)).find((p) => p.code === input.planCode);
    if (!plan) return { status: 'failed' as const, providerRef: null, reason: 'unknown_plan' };
    return this.record(input.requestId, input.phone, plan.amountKobo);
  }

  async requery(requestId: string): Promise<TopUpResult> {
    const found = this.requests.get(requestId);
    if (!found) return { status: 'failed', providerRef: null, reason: 'unknown_request' };
    return { status: found.status, providerRef: found.providerRef };
  }

  /** Test helper: a pending request is delivered (or fails) at the provider. */
  settle(requestId: string, status: 'delivered' | 'failed' = 'delivered') {
    const found = this.requests.get(requestId);
    if (found) found.status = status;
  }

  private record(requestId: string, phone: string, amountKobo: number): TopUpResult {
    const existing = this.requests.get(requestId);
    if (existing) return { status: existing.status, providerRef: existing.providerRef };
    const status: TopUpResult['status'] = phone.endsWith('0000')
      ? 'failed'
      : phone.endsWith('9999')
        ? 'pending'
        : 'delivered';
    const result = { status, providerRef: `fake_topup_${requestId.slice(-8)}`, phone, amountKobo };
    this.requests.set(requestId, result);
    return { status, providerRef: result.providerRef };
  }
}
