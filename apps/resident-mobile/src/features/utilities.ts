import type { ApiRow } from '@safezone/api-client';
import type { Tone } from '@safezone/mobile-ui';
import type { IconName } from '../components/icon';

export type UtilityProvider = ApiRow<'/v1/estates/{estateId}/utility-providers', 'get'>;
export type Meter = ApiRow<'/v1/estates/{estateId}/meters', 'get'>;
export type Outage = ApiRow<'/v1/estates/{estateId}/utility-outages', 'get'>;

export function utilityIcon(type: string): IconName {
  switch (type) {
    case 'electricity':
      return 'flash-outline';
    case 'water':
      return 'water-outline';
    case 'gas':
      return 'flame-outline';
    case 'internet':
      return 'wifi-outline';
    default:
      return 'construct-outline';
  }
}

export const OUTAGE_TONE: Record<Outage['status'], Tone> = {
  announced: 'warning',
  resolved: 'success',
  cancelled: 'neutral',
};

/** Splits outages into active (`announced`) and past (`resolved` or `cancelled`). */
export function partitionOutages(outages: readonly Outage[]): {
  active: Outage[];
  past: Outage[];
} {
  const active: Outage[] = [];
  const past: Outage[] = [];
  for (const item of outages) {
    if (item.status === 'announced') active.push(item);
    else past.push(item);
  }
  return { active, past };
}

/** Public providers a resident can register a meter with (excludes estate-managed sub-meters). */
export function publicProviders(providers: readonly UtilityProvider[]): UtilityProvider[] {
  return providers.filter((provider) => provider.supply === 'public');
}
