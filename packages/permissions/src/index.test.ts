import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  hasPermission,
  isAdvertiserPermission,
  isVendorPermission,
  VENDOR_PERMISSIONS,
  PERMISSIONS,
  permissionsForRoles,
  requiresMfa,
  SUPPORT_SESSION_PERMISSIONS,
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

describe('vendor permissions', () => {
  it('are held only by vendor roles, and vendor roles hold nothing else', () => {
    for (const role of BUILT_IN_ROLES) {
      const vendorHeld = role.permissions.filter((p) => isVendorPermission(p));
      if (role.level === 'vendor') expect(vendorHeld).toEqual(role.permissions);
      else expect(vendorHeld).toEqual([]);
    }
  });

  it('gives the owner every vendor permission and service personnel only order work', () => {
    expect(permissionsForRoles(['vendor_owner'])).toEqual(new Set(VENDOR_PERMISSIONS));
    expect([...permissionsForRoles(['vendor_service_personnel'])]).toEqual(['vendor.order.work']);
  });

  it('keeps vendor approval a platform permission', () => {
    expect(isVendorPermission('vendor.approve')).toBe(false);
    expect(hasPermission(['platform_administrator'], 'vendor.approve')).toBe(true);
  });

  it('lets residents shop and sell, and managers moderate', () => {
    expect(hasPermission(['tenant'], 'marketplace.use')).toBe(true);
    expect(hasPermission(['tenant'], 'marketplace.sell')).toBe(true);
    expect(hasPermission(['tenant'], 'marketplace.moderate')).toBe(false);
    expect(hasPermission(['estate_manager'], 'marketplace.moderate')).toBe(true);
  });
});

describe('advertiser permissions', () => {
  it('are held only by advertiser roles, and advertiser roles hold nothing else', () => {
    for (const role of BUILT_IN_ROLES) {
      const held = role.permissions.filter((p) => isAdvertiserPermission(p));
      if (role.level === 'advertiser') expect(held).toEqual(role.permissions);
      else expect(held).toEqual([]);
    }
  });

  it('lets agency representatives manage creatives but not pay', () => {
    expect(hasPermission(['advertising_agency_representative'], 'advertiser.creative.manage')).toBe(
      true,
    );
    expect(hasPermission(['advertising_agency_representative'], 'advertiser.invoice.pay')).toBe(
      false,
    );
    expect(isAdvertiserPermission('ad.campaign.manage')).toBe(false);
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

describe('SUPPORT_SESSION_PERMISSIONS', () => {
  it('is read-only and never reveals personal data', () => {
    expect(SUPPORT_SESSION_PERMISSIONS).not.toContain('pii.view');
    for (const permission of SUPPORT_SESSION_PERMISSIONS) {
      expect(permission.endsWith('.read')).toBe(true);
      expect(PERMISSIONS[permission]).toBeDefined();
    }
  });
});
