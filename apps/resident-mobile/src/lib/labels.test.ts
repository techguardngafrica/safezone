import { describe, expect, it } from 'vitest';
import { paymentMethodText, roleText } from './labels';

describe('labels', () => {
  it('translates known payment methods and humanises others', () => {
    expect(paymentMethodText('card')).toBe('Card');
    expect(paymentMethodText('dedicated_nuban')).toBe('Transfer to estate account');
    expect(paymentMethodText('pay_with_bank')).toBe('Pay with bank');
  });

  it('translates role keys', () => {
    expect(roleText('estate_administrator')).toBe('Estate administrator');
    expect(roleText('custom_role')).toBe('custom role');
  });
});
