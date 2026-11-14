/**
 * Bills aggregator adapter (utilities.md §2.1, AGENTS.md §5.7): meter validation now; token vending and bill
 * payment arrive once the purchase money flow is decided (ADR-0014 open item).
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

export abstract class BillsProvider {
  /** Validates a meter with its DisCo/provider; throws BillsProviderError(false) when not found. */
  abstract lookupMeter(providerCode: string, meterNumber: string): Promise<MeterLookup>;
}

/** Used where real money and users exist until an aggregator is integrated: never pretends to validate. */
export class UnconfiguredBillsProvider extends BillsProvider {
  async lookupMeter(): Promise<MeterLookup> {
    throw new BillsProviderError(true, 'Meter validation is not available yet');
  }
}

/** Deterministic fake: meter numbers starting with 0000 do not exist; odd last digits are postpaid. */
export class FakeBillsProvider extends BillsProvider {
  async lookupMeter(providerCode: string, meterNumber: string): Promise<MeterLookup> {
    if (meterNumber.startsWith('0000')) throw new BillsProviderError(false, 'Meter not found');
    const last = Number(meterNumber.at(-1));
    return {
      accountName: `CUSTOMER ${providerCode} ${meterNumber.slice(-4)}`,
      prepaid: Number.isNaN(last) || last % 2 === 0,
    };
  }
}
