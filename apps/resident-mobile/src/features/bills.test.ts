import { describe, expect, it } from 'vitest';
import { type Invoice, invoiceState, todayWat } from './bills';

const base = { status: 'issued', dueDate: '2026-12-02' } as Invoice;
const at = (iso: string) => Date.parse(iso);

describe('invoiceState', () => {
  it('reads WAT dates', () => {
    expect(todayWat(at('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
  });
  it('marks bills due within 3 days as due soon', () => {
    expect(invoiceState(base, at('2026-11-30T09:00:00Z')).tone).toBe('warning');
    expect(invoiceState(base, at('2026-11-18T09:00:00Z')).tone).toBe('neutral');
  });
  it('marks unpaid bills past their due date as overdue', () => {
    expect(invoiceState(base, at('2026-12-03T09:00:00Z')).tone).toBe('danger');
  });
  it('shows paid and part-paid bills', () => {
    expect(invoiceState({ ...base, status: 'paid' }).tone).toBe('success');
    expect(
      invoiceState({ ...base, status: 'partially_paid' }, at('2026-11-18T09:00:00Z')).tone,
    ).toBe('info');
  });
});
