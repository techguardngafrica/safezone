import { describe, expect, it } from 'vitest';
import {
  awaitingOwnerRequests,
  canCancelTransfer,
  canSellerConfirm,
  formatShare,
  type OwnerJoinRequest,
  type OwnershipTransfer,
} from './owner';

const request = (status: OwnerJoinRequest['status']): OwnerJoinRequest => ({
  id: '00000000-0000-0000-0000-000000000001',
  estateId: '00000000-0000-0000-0000-000000000002',
  userId: '00000000-0000-0000-0000-000000000003',
  fullName: 'Ada Obi',
  unit: { id: '00000000-0000-0000-0000-000000000004', code: 'A1', name: 'Flat A1' },
  relationship: 'tenant',
  householdId: null,
  message: null,
  status,
  reason: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  decidedAt: null,
  expiresAt: '2026-11-26T10:00:00.000Z',
});

const transfer = (overrides: Partial<OwnershipTransfer>): OwnershipTransfer => ({
  id: '00000000-0000-0000-0000-000000000010',
  spaceId: '00000000-0000-0000-0000-000000000004',
  unitCode: 'A1',
  type: 'sale',
  effectiveOn: '2026-12-01',
  fromOwnershipIds: [],
  toOwners: [{ name: 'Chidi Eze', companyName: null, shareBasisPoints: 10000 }],
  status: 'requested',
  requestedBy: 'owner-1',
  sellerConfirmedBy: null,
  managerOverride: false,
  decidedBy: null,
  reason: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  ...overrides,
});

describe('owner helpers', () => {
  it('formats basis points cleanly', () => {
    expect(formatShare(10000)).toBe('100%');
    expect(formatShare(5000)).toBe('50%');
    expect(formatShare(3333)).toBe('33.33%');
    expect(formatShare(2550)).toBe('25.5%');
  });

  it('filters only requests awaiting owner approval', () => {
    const list = awaitingOwnerRequests([
      request('awaiting_owner'),
      request('awaiting_manager'),
      request('approved'),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('awaiting_owner');
  });

  it('checks transfer confirm and cancel eligibility', () => {
    const req = transfer({ status: 'requested', requestedBy: 'owner-1' });
    const confirmed = transfer({ status: 'seller_confirmed', requestedBy: 'owner-1' });
    const done = transfer({ status: 'completed', requestedBy: 'owner-1' });

    expect(canSellerConfirm(req)).toBe(true);
    expect(canSellerConfirm(confirmed)).toBe(false);
    expect(canCancelTransfer(req, 'owner-1')).toBe(true);
    expect(canCancelTransfer(confirmed, 'owner-1')).toBe(true);
    expect(canCancelTransfer(confirmed, 'other')).toBe(false);
    expect(canCancelTransfer(done, 'owner-1')).toBe(false);
  });
});
