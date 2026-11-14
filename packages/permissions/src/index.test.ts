import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  hasPermission,
  permissionsForRoles,
  requiresMfa,
} from './index';

describe('permission catalogue', () => {
  it('only uses permissions that exist in the catalogue', () => {
    for (const role of BUILT_IN_ROLES) {
      for (const permission of role.permissions) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });

  it('has unique role keys', () => {
    const keys = BUILT_IN_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never gives estate roles a platform permission', () => {
    for (const role of BUILT_IN_ROLES.filter((r) => r.level === 'estate')) {
      expect(role.permissions.some((p) => p.startsWith('platform.') || p.startsWith('ad.'))).toBe(
        false,
      );
    }
  });
});

describe('role checks', () => {
  it('lets residents trigger SOS and invite visitors', () => {
    expect(hasPermission(['tenant'], 'sos.trigger')).toBe(true);
    expect(hasPermission(['tenant'], 'visitor.invite')).toBe(true);
  });

  it('does not let a security officer approve billing runs', () => {
    expect(hasPermission(['security_officer'], 'billing.run.approve')).toBe(false);
  });

  it('combines permissions from several roles', () => {
    const granted = permissionsForRoles(['estate_manager', 'tenant']);
    expect(granted.has('announcement.publish')).toBe(true);
    expect(granted.has('payment.make')).toBe(true);
  });
});

describe('requiresMfa', () => {
  it('is required for staff and platform roles', () => {
    expect(requiresMfa(['estate_manager'])).toBe(true);
    expect(requiresMfa(['security_officer'])).toBe(true);
    expect(requiresMfa(['super_admin'])).toBe(true);
    expect(requiresMfa(['tenant', 'estate_accountant'])).toBe(true);
  });

  it('is not required for residents and owners only', () => {
    expect(requiresMfa([])).toBe(false);
    expect(requiresMfa(['tenant', 'homeowner', 'property_owner'])).toBe(false);
  });

  it('treats unknown roles as staff (fail safe)', () => {
    expect(requiresMfa(['custom_role_key'])).toBe(true);
  });
});
