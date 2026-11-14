import { describe, expect, it } from 'vitest';
import {
  decideJoin,
  defaultMemberPermissions,
  firstJoinStep,
  normalisePlate,
  parsePermissions,
  roleForRelationship,
} from './occupancy';

describe('join request routing', () => {
  it('routes by relationship and policy', () => {
    expect(firstJoinStep('household_member', 'owner_then_manager_override', true)).toBe(
      'awaiting_household_head',
    );
    expect(firstJoinStep('owner', 'owner_then_manager_override', true)).toBe('awaiting_manager');
    expect(firstJoinStep('tenant', 'owner_then_manager_override', true)).toBe('awaiting_owner');
    expect(firstJoinStep('tenant', 'owner_only', true)).toBe('awaiting_owner');
    expect(firstJoinStep('tenant', 'manager_only', true)).toBe('awaiting_manager');
    // No ownership record yet (Phase 1): the manager decides.
    expect(firstJoinStep('tenant', 'owner_then_manager_override', false)).toBe('awaiting_manager');
  });
});

describe('join request decisions', () => {
  const policy = 'owner_then_manager_override';
  it('lets the right approver move each step', () => {
    expect(decideJoin('awaiting_household_head', 'household_head', 'approve', policy)).toBe(
      'approved',
    );
    expect(decideJoin('awaiting_owner', 'owner', 'approve', policy)).toBe('awaiting_manager');
    expect(decideJoin('awaiting_owner', 'owner', 'approve', 'owner_only')).toBe('approved');
    expect(decideJoin('awaiting_manager', 'manager', 'approve', policy)).toBe('approved');
    expect(decideJoin('awaiting_owner', 'owner', 'reject', policy)).toBe('rejected');
  });
  it('lets managers override any open step', () => {
    expect(decideJoin('awaiting_owner', 'manager', 'approve', policy)).toBe('approved');
    expect(decideJoin('awaiting_household_head', 'manager', 'reject', policy)).toBe('rejected');
  });
  it('refuses the wrong approver and closed requests', () => {
    expect(decideJoin('awaiting_manager', 'owner', 'approve', policy)).toBeNull();
    expect(decideJoin('awaiting_manager', 'household_head', 'approve', policy)).toBeNull();
    expect(decideJoin('awaiting_owner', 'household_head', 'approve', policy)).toBeNull();
    for (const closed of ['approved', 'rejected', 'cancelled', 'expired'])
      expect(decideJoin(closed, 'manager', 'approve', policy)).toBeNull();
  });
});

describe('helpers', () => {
  it('maps relationships to roles', () => {
    expect(roleForRelationship('owner')).toBe('homeowner');
    expect(roleForRelationship('tenant')).toBe('tenant');
    expect(roleForRelationship('household_member')).toBe('household_member');
  });
  it('gives minors SOS only by default', () => {
    expect(defaultMemberPermissions(true)).toEqual({
      inviteVisitors: false,
      triggerSos: true,
      payBills: false,
      viewBills: false,
      receiveGateAlerts: false,
    });
    expect(defaultMemberPermissions(false).inviteVisitors).toBe(true);
    expect(defaultMemberPermissions(false).payBills).toBe(false);
  });
  it('parses stored permissions defensively', () => {
    expect(parsePermissions({ inviteVisitors: true, triggerSos: 'yes' })).toMatchObject({
      inviteVisitors: true,
      triggerSos: false,
    });
    expect(parsePermissions(null).inviteVisitors).toBe(false);
  });
  it('normalises plates', () => {
    expect(normalisePlate(' lag 123-ab ')).toBe('LAG123AB');
  });
});
