import { describe, expect, it } from 'vitest';
import { checkChargeDraft, draftFromCharge, newChargeDraft } from './charge-form';
import type { Charge } from './finance-labels';

const base = () => ({ ...newChargeDraft('2027-01-01'), name: 'Estate dues', amount: '15000' });

describe('checkChargeDraft', () => {
  it('builds a fixed rule in kobo', () => {
    const result = checkChargeDraft(base());
    expect(result).toEqual({
      ok: true,
      value: { amountRule: { kind: 'fixed', amount: 1_500_000 }, penaltyRule: null },
    });
  });

  it('names each invalid field', () => {
    const result = checkChargeDraft({
      ...base(),
      name: 'x',
      amount: 'abc',
      endsOn: '2026-12-31',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['amount', 'endsOn', 'name']);
  });

  it('needs at least one unit type amount and skips empty ones', () => {
    const empty = checkChargeDraft({ ...base(), ruleKind: 'per_unit_type' });
    expect(empty.ok).toBe(false);
    const draft = base();
    draft.ruleKind = 'per_unit_type';
    draft.perType.flat = '10000';
    draft.perType.house = '20000.5';
    expect(checkChargeDraft(draft)).toMatchObject({
      ok: true,
      value: {
        amountRule: { kind: 'per_unit_type', amounts: { flat: 1_000_000, house: 2_000_050 } },
      },
    });
  });

  it('reads a percentage penalty with an optional cap', () => {
    const result = checkChargeDraft({
      ...base(),
      penaltyKind: 'percent',
      penaltyPercent: '5',
      penaltyCap: '5000',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { penaltyRule: { kind: 'percent', basisPoints: 500, cap: 500_000 } },
    });
    const noCap = checkChargeDraft({ ...base(), penaltyKind: 'percent', penaltyPercent: '2.5' });
    expect(noCap).toMatchObject({
      ok: true,
      value: { penaltyRule: { kind: 'percent', basisPoints: 250 } },
    });
    const bad = checkChargeDraft({ ...base(), penaltyKind: 'percent', penaltyPercent: '80' });
    expect(bad.ok).toBe(false);
  });

  it('checks per-bedroom minimums', () => {
    const result = checkChargeDraft({ ...base(), ruleKind: 'per_bedroom', minimumBedrooms: '2' });
    expect(result).toMatchObject({
      ok: true,
      value: { amountRule: { kind: 'per_bedroom', amount: 1_500_000, minimumBedrooms: 2 } },
    });
    expect(checkChargeDraft({ ...base(), ruleKind: 'per_bedroom', minimumBedrooms: '-1' }).ok).toBe(
      false,
    );
  });
});

describe('draftFromCharge', () => {
  it('round-trips a charge through the form', () => {
    const charge = {
      id: '01936b2e-0000-7000-8000-000000000099',
      type: 'security_levy',
      name: 'Security levy',
      description: null,
      amountRule: { kind: 'per_unit_type', amounts: { flat: 500_000 } },
      frequency: 'quarterly',
      payer: 'owner',
      appliesTo: { spaceIds: [], unitTypes: [] },
      startsOn: '2027-01-01',
      endsOn: null,
      penaltyRule: { kind: 'fixed', amount: 100_000 },
      status: 'active',
      currency: 'NGN',
      version: 1,
      createdAt: '2026-11-18T10:00:00.000Z',
    } satisfies Charge;
    const draft = draftFromCharge(charge);
    expect(draft.perType.flat).toBe('5000');
    expect(checkChargeDraft(draft)).toEqual({
      ok: true,
      value: { amountRule: charge.amountRule, penaltyRule: charge.penaltyRule },
    });
  });
});
