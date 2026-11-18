import { t } from '@safezone/i18n';
import {
  basisPointsToInput,
  koboToInput,
  parsePercentToBasisPoints,
  parsePositiveNaira,
} from '../../../lib/money';
import type { AmountRule, Charge, UnitType } from './finance-labels';
import { UNIT_TYPES } from './finance-labels';

export type RuleKind = 'fixed' | 'per_bedroom' | 'per_sqm' | 'per_unit_type';
export type PenaltyKind = 'none' | 'fixed' | 'percent';

/** Everything the charge form edits, as typed text. */
export interface ChargeDraft {
  type: Charge['type'];
  name: string;
  description: string;
  frequency: Charge['frequency'];
  payer: Charge['payer'];
  ruleKind: RuleKind;
  amount: string;
  minimumBedrooms: string;
  perType: Record<UnitType, string>;
  startsOn: string;
  endsOn: string;
  penaltyKind: PenaltyKind;
  penaltyAmount: string;
  penaltyPercent: string;
  penaltyCap: string;
}

export type ChargeField =
  | 'name'
  | 'amount'
  | 'minimumBedrooms'
  | 'perType'
  | 'startsOn'
  | 'endsOn'
  | 'penaltyAmount'
  | 'penaltyPercent'
  | 'penaltyCap';

const emptyPerType = (): Record<UnitType, string> =>
  Object.fromEntries(UNIT_TYPES.map((type) => [type, ''])) as Record<UnitType, string>;

export function newChargeDraft(today: string): ChargeDraft {
  return {
    type: 'estate_dues',
    name: '',
    description: '',
    frequency: 'monthly',
    payer: 'occupant',
    ruleKind: 'fixed',
    amount: '',
    minimumBedrooms: '1',
    perType: emptyPerType(),
    startsOn: today,
    endsOn: '',
    penaltyKind: 'none',
    penaltyAmount: '',
    penaltyPercent: '',
    penaltyCap: '',
  };
}

/** The form's starting text for an existing charge. Metered rules are not edited here. */
export function draftFromCharge(charge: Charge): ChargeDraft {
  const draft = newChargeDraft(charge.startsOn);
  draft.type = charge.type;
  draft.name = charge.name;
  draft.description = charge.description ?? '';
  draft.frequency = charge.frequency;
  draft.payer = charge.payer;
  draft.endsOn = charge.endsOn ?? '';
  const rule = charge.amountRule;
  if (rule.kind === 'fixed' || rule.kind === 'per_sqm') {
    draft.ruleKind = rule.kind;
    draft.amount = koboToInput(rule.amount);
  } else if (rule.kind === 'per_bedroom') {
    draft.ruleKind = 'per_bedroom';
    draft.amount = koboToInput(rule.amount);
    draft.minimumBedrooms = String(rule.minimumBedrooms);
  } else if (rule.kind === 'per_unit_type') {
    draft.ruleKind = 'per_unit_type';
    for (const type of UNIT_TYPES) {
      const amount = rule.amounts[type];
      draft.perType[type] = amount ? koboToInput(amount) : '';
    }
  }
  const penalty = charge.penaltyRule;
  if (penalty?.kind === 'fixed') {
    draft.penaltyKind = 'fixed';
    draft.penaltyAmount = koboToInput(penalty.amount);
  } else if (penalty?.kind === 'percent') {
    draft.penaltyKind = 'percent';
    draft.penaltyPercent = basisPointsToInput(penalty.basisPoints);
    draft.penaltyCap = penalty.cap ? koboToInput(penalty.cap) : '';
  }
  return draft;
}

type PenaltyRule = NonNullable<Charge['penaltyRule']>;
export interface CheckedCharge {
  amountRule: AmountRule;
  penaltyRule: PenaltyRule | null;
}

/** Checks the draft the way the API will, so each problem shows on its own input. */
export function checkChargeDraft(
  draft: ChargeDraft,
):
  { ok: true; value: CheckedCharge } | { ok: false; errors: Partial<Record<ChargeField, string>> } {
  const errors: Partial<Record<ChargeField, string>> = {};
  if (draft.name.trim().length < 2) errors.name = t('finance.nameRequired');
  if (!draft.startsOn) errors.startsOn = t('finance.dateRequired');
  if (draft.endsOn && draft.startsOn && draft.endsOn < draft.startsOn)
    errors.endsOn = t('charge.form.endsBeforeStart');

  let amountRule: AmountRule | null = null;
  if (draft.ruleKind === 'per_unit_type') {
    const amounts: Partial<Record<UnitType, number>> = {};
    let bad = false;
    for (const type of UNIT_TYPES) {
      const text = draft.perType[type].trim();
      if (!text) continue;
      const kobo = parsePositiveNaira(text);
      if (kobo === null) bad = true;
      else amounts[type] = kobo;
    }
    if (bad) errors.perType = t('finance.amountInvalid');
    else if (Object.keys(amounts).length === 0) errors.perType = t('charge.form.perTypeRequired');
    else amountRule = { kind: 'per_unit_type', amounts };
  } else {
    const amount = parsePositiveNaira(draft.amount);
    if (amount === null) errors.amount = t('finance.amountInvalid');
    else if (draft.ruleKind === 'per_bedroom') {
      const minimum = Number(draft.minimumBedrooms);
      if (!/^\d{1,2}$/.test(draft.minimumBedrooms.trim()) || minimum > 20)
        errors.minimumBedrooms = t('invoice.oneOff.qtyInvalid');
      else amountRule = { kind: 'per_bedroom', amount, minimumBedrooms: minimum };
    } else amountRule = { kind: draft.ruleKind, amount };
  }

  let penaltyRule: PenaltyRule | null = null;
  if (draft.penaltyKind === 'fixed') {
    const amount = parsePositiveNaira(draft.penaltyAmount);
    if (amount === null) errors.penaltyAmount = t('finance.amountInvalid');
    else penaltyRule = { kind: 'fixed', amount };
  } else if (draft.penaltyKind === 'percent') {
    const basisPoints = parsePercentToBasisPoints(draft.penaltyPercent);
    if (basisPoints === null) errors.penaltyPercent = t('charge.form.penaltyPercentInvalid');
    const capText = draft.penaltyCap.trim();
    const cap = capText ? parsePositiveNaira(capText) : undefined;
    if (cap === null) errors.penaltyCap = t('finance.amountInvalid');
    if (basisPoints !== null && cap !== null)
      penaltyRule = { kind: 'percent', basisPoints, ...(cap ? { cap } : {}) };
  }

  if (Object.keys(errors).length > 0 || !amountRule) return { ok: false, errors };
  return { ok: true, value: { amountRule, penaltyRule } };
}

/** Maps API validation paths (`body.amountRule.amount`) to form inputs. */
export const CHARGE_FIELD_PATHS: Record<string, ChargeField> = {
  name: 'name',
  'amountRule.amount': 'amount',
  'amountRule.minimumBedrooms': 'minimumBedrooms',
  'amountRule.amounts': 'perType',
  startsOn: 'startsOn',
  endsOn: 'endsOn',
  'penaltyRule.amount': 'penaltyAmount',
  'penaltyRule.basisPoints': 'penaltyPercent',
  'penaltyRule.cap': 'penaltyCap',
};
