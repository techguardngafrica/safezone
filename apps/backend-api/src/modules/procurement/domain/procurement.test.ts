import { describe, expect, it } from 'vitest';
import {
  computeWeightedAverageCost,
  isWithinThreeWayTolerance,
  requiredApprovalRoles,
  signedQtyDelta,
} from './procurement';

describe('procurement domain rules', () => {
  it('assigns ordered approval bands by amount', () => {
    expect(requiredApprovalRoles(5_000_000)).toEqual(['facility_manager']);
    expect(requiredApprovalRoles(50_000_000)).toEqual(['facility_manager', 'estate_manager']);
    expect(requiredApprovalRoles(150_000_000)).toEqual([
      'facility_manager',
      'estate_manager',
      'estate_owner',
    ]);
  });

  it('enforces three-way match tolerance', () => {
    expect(isWithinThreeWayTolerance(100_000, 102_000, 2).ok).toBe(true);
    expect(isWithinThreeWayTolerance(100_000, 102_500, 2).ok).toBe(false);
    expect(isWithinThreeWayTolerance(100_000, 98_000, 2).ok).toBe(true);
  });

  it('computes weighted average cost on receipt', () => {
    expect(computeWeightedAverageCost(10, 1_000, 10, 2_000)).toBe(1_500);
    expect(computeWeightedAverageCost(0, 0, 5, 3_000)).toBe(3_000);
  });

  it('computes signed stock deltas', () => {
    expect(signedQtyDelta('receipt', 5)).toBe(5);
    expect(signedQtyDelta('issue', 3)).toBe(-3);
    expect(signedQtyDelta('adjustment', 2, 'out')).toBe(-2);
    expect(signedQtyDelta('adjustment', 2, 'in')).toBe(2);
  });
});
