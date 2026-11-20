/**
 * Bills aggregator adapter (utilities.md §2.1, AGENTS.md §5.7): meter validation and prepaid token vending
 * (ADR-0018). Bill payment for postpaid meters is not built.
 */
export interface MeterLookup {
  accountName: string;
  prepaid: boolean;
}

export class BillsProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    message = 'Bills provider request failed',
  ) {
    super(message);
    this.name = 'BillsProviderError';
  }
}

export interface VendResult {
  /** The token the resident types into the meter. A secret: wrap before storing, never log. */
  token: string;
  unitsKwh: number | null;
  providerRef: string;
}

export abstract class BillsProvider {
  /** False until an aggregator is configured: purchases must not be taken (ADR-0018 point 5). */
  abstract readonly canVend: boolean;
  /** Validates a meter with its DisCo/provider; throws BillsProviderError(false) when not found. */
  abstract lookupMeter(providerCode: string, meterNumber: string): Promise<MeterLookup>;
  /**
   * Buys a prepaid token. Idempotent on `requestId`: asking again for the same purchase returns the same
   * token. Throws BillsProviderError(retryable) on failure.
   */
  abstract vend(input: {
    requestId: string;
    providerCode: string;
    meterNumber: string;
    amountKobo: number;
  }): Promise<VendResult>;
}

/** Used where real money and users exist until an aggregator is integrated: never pretends to validate. */
export class UnconfiguredBillsProvider extends BillsProvider {
  readonly canVend = false;
  async lookupMeter(): Promise<MeterLookup> {
    throw new BillsProviderError(true, 'Meter validation is not available yet');
  }
  async vend(): Promise<VendResult> {
    throw new BillsProviderError(false, 'Token vending is not available yet');
  }
}

/** Deterministic fake: meter numbers starting with 0000 do not exist; odd last digits are postpaid. */
export class FakeBillsProvider extends BillsProvider {
  readonly canVend = true;
  private readonly vended = new Map<string, VendResult>();
  /** Test helper: meters whose next vends fail (retryable), keyed by meter number. */
  readonly failing = new Map<string, number>();

  /** Deterministic 20-digit token per request; meters starting 9999 always fail permanently. */
  async vend(input: {
    requestId: string;
    providerCode: string;
    meterNumber: string;
    amountKobo: number;
  }): Promise<VendResult> {
    const existing = this.vended.get(input.requestId);
    if (existing) return existing;
    if (input.meterNumber.startsWith('9999'))
      throw new BillsProviderError(false, 'Meter cannot be vended');
    const failures = this.failing.get(input.meterNumber) ?? 0;
    if (failures > 0) {
      this.failing.set(input.meterNumber, failures - 1);
      throw new BillsProviderError(true, 'Aggregator timeout');
    }
    const digits = input.requestId
      .replace(/[^0-9]/g, '')
      .padEnd(20, '7')
      .slice(0, 20);
    const result = {
      token: digits.replace(/(\d{4})(?=\d)/g, '$1-'),
      // Illustrative tariff for tests only: ₦100 per kWh.
      unitsKwh: Math.round((input.amountKobo / 10_000) * 10) / 10,
      providerRef: `fake_vend_${input.requestId.slice(-8)}`,
    };
    this.vended.set(input.requestId, result);
    return result;
  }

  async lookupMeter(providerCode: string, meterNumber: string): Promise<MeterLookup> {
    if (meterNumber.startsWith('0000')) throw new BillsProviderError(false, 'Meter not found');
    const last = Number(meterNumber.at(-1));
    return {
      accountName: `CUSTOMER ${providerCode} ${meterNumber.slice(-4)}`,
      prepaid: Number.isNaN(last) || last % 2 === 0,
    };
  }
}
