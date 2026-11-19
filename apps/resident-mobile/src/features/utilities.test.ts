import { describe, expect, it } from 'vitest';
import { type Outage, partitionOutages, publicProviders, utilityIcon } from './utilities';

const baseOutage = (overrides: Partial<Outage>): Outage => ({
  id: '00000000-0000-0000-0000-000000000001',
  type: 'electricity',
  title: 'Transformer maintenance',
  details: null,
  startsAt: '2026-11-19T10:00:00.000Z',
  expectedEndAt: null,
  spaceIds: [],
  status: 'announced',
  notified: 10,
  createdAt: '2026-11-19T09:00:00.000Z',
  ...overrides,
});

describe('utilities helpers', () => {
  it('partitions active and past outages', () => {
    const result = partitionOutages([
      baseOutage({ id: '1', status: 'announced' }),
      baseOutage({ id: '2', status: 'resolved' }),
      baseOutage({ id: '3', status: 'cancelled' }),
    ]);
    expect(result.active.map((o) => o.id)).toEqual(['1']);
    expect(result.past.map((o) => o.id)).toEqual(['2', '3']);
  });

  it('filters to public utility providers only', () => {
    const list = publicProviders([
      { code: 'IKEDC', name: 'Ikeja Electric', type: 'electricity', supply: 'public' },
      { code: 'ESTATE', name: 'Estate supply', type: 'electricity', supply: 'estate' },
    ]);
    expect(list.map((p) => p.code)).toEqual(['IKEDC']);
  });

  it('maps utility types to outline icons', () => {
    expect(utilityIcon('electricity')).toBe('flash-outline');
    expect(utilityIcon('water')).toBe('water-outline');
    expect(utilityIcon('gas')).toBe('flame-outline');
    expect(utilityIcon('internet')).toBe('wifi-outline');
    expect(utilityIcon('waste')).toBe('construct-outline');
  });
});
