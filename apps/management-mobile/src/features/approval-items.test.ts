import { describe, expect, it } from 'vitest';
import {
  badgeLabel,
  filterApprovals,
  reasonIsValid,
  toApprovalItems,
  type ApprovalFormat,
} from './approval-items';

const format: ApprovalFormat = {
  unknownName: 'Unknown',
  relationship: (value) => value.toUpperCase(),
  money: (kobo) => `N${kobo / 100}`,
  dateTime: (iso) => `at ${iso}`,
  runDetail: (invoices, amount) => `${invoices} invoices, ${amount}`,
  moveType: (type) => (type === 'move_in' ? 'Move-in' : 'Move-out'),
  moveDetail: (type, unit, date) => `${type} · ${unit} · ${date}`,
  transferDetail: (unit, type) => `${unit} · ${type}`,
  paymentDetail: (method, ref) => `${method} · ${ref}`,
};

describe('toApprovalItems', () => {
  it('keeps only items waiting for management, newest first', () => {
    const items = toApprovalItems(
      {
        joins: [
          {
            id: 'j1',
            fullName: 'Ada',
            unit: { code: 'A1', name: 'Block A 1' },
            relationship: 'tenant',
            message: 'Hello',
            status: 'awaiting_manager',
            createdAt: '2026-11-20T10:00:00.000Z',
          },
          {
            id: 'j2',
            fullName: 'Bola',
            unit: { code: 'A2', name: '' },
            relationship: 'owner',
            message: null,
            status: 'awaiting_owner',
            createdAt: '2026-11-21T10:00:00.000Z',
          },
        ],
        runs: [
          {
            id: 'r1',
            label: 'November service charge',
            status: 'awaiting_approval',
            totals: { invoices: 12, amount: 1_200_000 },
            createdAt: '2026-11-21T09:00:00.000Z',
          },
          { id: 'r2', label: 'Draft', status: 'draft', totals: null, createdAt: '2026-11-21' },
        ],
        waivers: [
          {
            id: 'w1',
            invoiceId: 'i1',
            amount: 50_000,
            reason: 'Water outage',
            status: 'pending',
            createdAt: '2026-11-19T09:00:00.000Z',
          },
        ],
        manualPayments: [
          {
            id: 'mp1',
            amount: 250_000,
            method: 'bank_transfer',
            reference: 'REF-1',
            note: 'Paid at office',
            status: 'pending',
            createdAt: '2026-11-21T12:00:00.000Z',
          },
        ],
        refunds: [
          {
            id: 'rf1',
            amount: 100_000,
            reason: 'Double charge',
            status: 'pending',
            createdAt: '2026-11-21T08:00:00.000Z',
          },
        ],
        bookings: [
          {
            id: 'b1',
            facilityName: 'Hall',
            startsAt: '2026-11-30T15:00:00.000Z',
            purpose: 'Birthday',
            status: 'pending_approval',
            createdAt: '2026-11-21T11:00:00.000Z',
          },
          {
            id: 'b2',
            facilityName: 'Court',
            startsAt: '2026-11-30T15:00:00.000Z',
            purpose: null,
            status: 'confirmed',
            createdAt: '2026-11-21T12:00:00.000Z',
          },
        ],
        domesticStaff: [
          { id: 'ds1', name: 'Musa', role: 'Driver', status: 'pending' },
          { id: 'ds2', name: 'Grace', role: 'Chef', status: 'active' },
        ],
        moves: [
          {
            id: 'm1',
            type: 'move_in',
            unitCode: 'B3',
            scheduledOn: '2026-11-25',
            gateNotice: 'Truck at 9am',
            status: 'scheduled',
            createdAt: '2026-11-20T12:00:00.000Z',
          },
        ],
        channels: [
          {
            id: 'c1',
            name: 'Tennis Club',
            description: 'Weekly matches',
            category: 'social',
            status: 'pending_approval',
            createdAt: '2026-11-20T08:00:00.000Z',
          },
        ],
        ownershipTransfers: [
          {
            id: 'ot1',
            unitCode: 'C2',
            type: 'sale',
            reason: 'Completed sale',
            status: 'confirmed',
            createdAt: '2026-11-21T10:30:00.000Z',
          },
        ],
      },
      format,
    );
    expect(items.map((item) => item.id)).toEqual([
      'mp1',
      'b1',
      'ot1',
      'r1',
      'rf1',
      'm1',
      'j1',
      'c1',
      'w1',
      'ds1',
    ]);
    expect(items[0]).toMatchObject({ kind: 'manual_payment', title: 'N2500' });
    expect(filterApprovals(items, 'finance').map((i) => i.id)).toEqual(['mp1', 'r1', 'rf1', 'w1']);
    expect(filterApprovals(items, 'people').map((i) => i.id)).toEqual(['ot1', 'm1', 'j1', 'ds1']);
    expect(filterApprovals(items, 'facilities').map((i) => i.id)).toEqual(['b1']);
    expect(filterApprovals(items, 'community').map((i) => i.id)).toEqual(['c1']);
    expect(filterApprovals(items, 'all')).toHaveLength(10);
  });

  it('names applicants without a profile name', () => {
    const [item] = toApprovalItems(
      {
        joins: [
          {
            id: 'j1',
            fullName: null,
            unit: { code: 'B4', name: '' },
            relationship: 'household_member',
            message: null,
            status: 'awaiting_manager',
            createdAt: '2026-11-20T10:00:00.000Z',
          },
        ],
      },
      format,
    );
    expect(item?.title).toBe('Unknown');
  });

  it('returns nothing when no source has loaded', () => {
    expect(toApprovalItems({}, format)).toEqual([]);
  });
});

describe('reasonIsValid', () => {
  it('needs a reason of 3+ characters to reject', () => {
    expect(reasonIsValid('reject', '')).toBe(false);
    expect(reasonIsValid('reject', ' no ')).toBe(false);
    expect(reasonIsValid('reject', 'Wrong unit')).toBe(true);
  });

  it('allows approving with no note, but not a 1-2 character one', () => {
    expect(reasonIsValid('approve', '')).toBe(true);
    expect(reasonIsValid('approve', 'ok')).toBe(false);
    expect(reasonIsValid('approve', 'Checked with owner')).toBe(true);
  });
});

describe('badgeLabel', () => {
  it('caps at 9+', () => {
    expect(badgeLabel(3)).toBe('3');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
  });
});
