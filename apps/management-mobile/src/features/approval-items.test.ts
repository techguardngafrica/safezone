import { describe, expect, it } from 'vitest';
import { badgeLabel, reasonIsValid, toApprovalItems, type ApprovalFormat } from './approval-items';

const format: ApprovalFormat = {
  unknownName: 'Unknown',
  relationship: (value) => value.toUpperCase(),
  money: (kobo) => `N${kobo / 100}`,
  dateTime: (iso) => `at ${iso}`,
  runDetail: (invoices, amount) => `${invoices} invoices, ${amount}`,
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
      },
      format,
    );
    expect(items.map((item) => item.id)).toEqual(['b1', 'r1', 'j1', 'w1']);
    expect(items[1]).toMatchObject({ kind: 'billing_run', detail: '12 invoices, N12000' });
    expect(items[2]).toMatchObject({ kind: 'join', title: 'Ada', detail: 'A1 · TENANT' });
    expect(items[3]).toMatchObject({ kind: 'waiver', invoiceId: 'i1', title: 'N500' });
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
