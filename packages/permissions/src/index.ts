/**
 * @safezone/permissions — single source of truth for permissions and built-in roles.
 * Spec: docs/architecture/modules/authz.md. Changing this file changes who can do what:
 * update the catalogue, the roles and the tests in the same pull request.
 */

export const PERMISSIONS = {
  // Estate configuration
  'estate.configure': 'Change estate profile, policies and settings',
  'space.manage': 'Create and edit phases, buildings and units',
  'role.assign': 'Assign and revoke estate roles',
  'pii.view': 'See unmasked personal data (phone numbers, ID references)',
  'import.run': 'Run bulk imports',

  // People
  'resident.approve': 'Approve or reject join requests',
  'resident.read': 'View the resident directory',
  'household.manage': 'Manage own household members and permissions',

  // Visitors and security
  'visitor.invite': 'Create visitor passes',
  'visitor.log.read': 'View the visitor log',
  'gate.verify': 'Verify passes and record gate entries/exits',
  'gate.device.manage': 'Register and deregister gate devices',
  'security.staff.manage': 'Manage guards, gates and shifts',
  'incident.report': 'Report an incident',
  'incident.manage': 'Triage, assign and resolve incidents',

  // Emergency
  'sos.trigger': 'Trigger an SOS alert',
  'sos.respond': 'Acknowledge, assign and resolve SOS alerts',
  'broadcast.emergency': 'Send an emergency broadcast to the whole estate',

  // Communication
  'announcement.publish': 'Publish official estate announcements',
  'community.moderate': 'Moderate channels and messages',
  'community.channel.create': 'Create resident channels',

  // Money (estate billing residents)
  'charge.manage': 'Define estate charges',
  'billing.run.create': 'Prepare billing runs',
  'billing.run.approve': 'Approve billing runs (second approver)',
  'invoice.read': 'View invoices',
  'payment.make': 'Pay invoices',
  'payment.refund': 'Request refunds',
  'payment.reconcile': 'Reconcile transactions',

  // Operations
  'maintenance.request': 'Submit maintenance requests',
  'maintenance.assign': 'Triage and assign maintenance work',
  'facility.book': 'Book estate facilities',
  'facility.manage': 'Manage facilities and bookings',
  'document.manage': 'Manage estate documents',
  'report.read': 'View estate reports',
  'audit.read': 'View the estate audit log',

  // Marketplace inside an estate (marketplace.md, ADR-0023)
  'marketplace.use': 'Browse the marketplace, order from vendors and review orders',
  'marketplace.sell': 'Post items and services in the estate classifieds',
  'marketplace.moderate': 'Approve or block vendors for the estate and moderate classifieds',

  // Platform (Techguard)
  'platform.estate.approve': 'Approve, reject, suspend or deactivate estates',
  'platform.estate.create': 'Create estates on behalf of customers (assisted onboarding)',
  'platform.user.manage': 'Lock, unlock and recover user accounts',
  'platform.support_access': 'Request support access to an estate',
  'platform.staff.manage': 'Manage platform staff and platform roles',
  'platform.config': 'Change feature flags, app versions and providers',
  'platform.compliance': 'Handle data subject requests, breaches and retention',
  'platform.finance': 'View platform transactions and revenue',
  'ad.enquiry.manage': 'Manage advertising enquiries and advertisers',
  'ad.campaign.manage': 'Create and schedule campaigns',
  'ad.campaign.review': 'Review and approve campaigns and creatives',
  'vendor.approve': 'Verify, approve and suspend vendors; handle order disputes',

  // Vendor organisation (evaluated against the caller's vendor membership, ADR-0023)
  'vendor.profile.manage': 'Edit the vendor profile, documents, service areas and payout account',
  'vendor.team.manage': 'Add, change and remove vendor team members',
  'vendor.listing.manage': 'Create and edit vendor listings',
  'vendor.order.manage': 'Accept, decline, quote, schedule and assign orders',
  'vendor.order.work': 'Start and complete assigned orders and message the customer',
  'vendor.payout.read': 'View earnings and payouts',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleLevel = 'platform' | 'estate' | 'vendor' | 'advertiser';

export interface RoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly level: RoleLevel;
  readonly permissions: readonly Permission[];
}

const residentBase: Permission[] = [
  'visitor.invite',
  'sos.trigger',
  'incident.report',
  'household.manage',
  'invoice.read',
  'payment.make',
  'maintenance.request',
  'facility.book',
  'community.channel.create',
  'marketplace.use',
  'marketplace.sell',
];

const managerBase: Permission[] = [
  'space.manage',
  'pii.view',
  'import.run',
  'resident.approve',
  'resident.read',
  'visitor.log.read',
  'incident.manage',
  'sos.respond',
  'broadcast.emergency',
  'announcement.publish',
  'community.moderate',
  'billing.run.approve',
  'invoice.read',
  'maintenance.assign',
  'facility.manage',
  'document.manage',
  'report.read',
  'marketplace.moderate',
];

/** Vendor-level permissions: checked against vendor_members, never against estate or platform roles. */
export const VENDOR_PERMISSIONS = [
  'vendor.profile.manage',
  'vendor.team.manage',
  'vendor.listing.manage',
  'vendor.order.manage',
  'vendor.order.work',
  'vendor.payout.read',
] as const satisfies readonly Permission[];

export function isVendorPermission(permission: string): boolean {
  return (VENDOR_PERMISSIONS as readonly string[]).includes(permission);
}

export const BUILT_IN_ROLES: readonly RoleDefinition[] = [
  // Estate level
  {
    key: 'estate_owner',
    name: 'Estate Owner',
    level: 'estate',
    permissions: [
      ...managerBase,
      'estate.configure',
      'role.assign',
      'audit.read',
      'charge.manage',
      'gate.device.manage',
      'security.staff.manage',
    ],
  },
  {
    key: 'estate_administrator',
    name: 'Estate Administrator',
    level: 'estate',
    permissions: [
      ...managerBase,
      'estate.configure',
      'role.assign',
      'audit.read',
      'charge.manage',
      'gate.device.manage',
      'security.staff.manage',
    ],
  },
  { key: 'estate_manager', name: 'Estate Manager', level: 'estate', permissions: managerBase },
  {
    key: 'estate_accountant',
    name: 'Estate Accountant',
    level: 'estate',
    permissions: [
      'pii.view',
      'resident.read',
      'charge.manage',
      'billing.run.create',
      'invoice.read',
      'payment.refund',
      'payment.reconcile',
      'report.read',
    ],
  },
  {
    key: 'facility_manager',
    name: 'Facility Manager',
    level: 'estate',
    permissions: [
      'resident.read',
      'maintenance.assign',
      'facility.manage',
      'document.manage',
      'report.read',
    ],
  },
  {
    key: 'security_supervisor',
    name: 'Security Supervisor',
    level: 'estate',
    permissions: [
      'gate.verify',
      'visitor.log.read',
      'incident.report',
      'incident.manage',
      'sos.trigger',
      'sos.respond',
      'broadcast.emergency',
      'security.staff.manage',
      'gate.device.manage',
    ],
  },
  {
    key: 'security_officer',
    name: 'Security Officer',
    level: 'estate',
    permissions: ['gate.verify', 'incident.report', 'sos.trigger', 'sos.respond'],
  },
  {
    key: 'maintenance_officer',
    name: 'Maintenance Officer',
    level: 'estate',
    permissions: ['maintenance.request'],
  },
  {
    key: 'procurement_officer',
    name: 'Procurement Officer',
    level: 'estate',
    permissions: ['report.read'],
  },
  { key: 'resident', name: 'Resident', level: 'estate', permissions: residentBase },
  {
    key: 'homeowner',
    name: 'Homeowner',
    level: 'estate',
    permissions: [...residentBase, 'resident.approve'],
  },
  { key: 'tenant', name: 'Tenant', level: 'estate', permissions: residentBase },
  { key: 'household_member', name: 'Household Member', level: 'estate', permissions: residentBase },
  {
    key: 'property_owner',
    name: 'Property Owner (non-resident)',
    level: 'estate',
    permissions: ['resident.approve', 'invoice.read', 'payment.make'],
  },

  // Platform level (Techguard)
  {
    key: 'super_admin',
    name: 'Super Admin',
    level: 'platform',
    permissions: ALL_PERMISSIONS.filter(
      (p) => p.startsWith('platform.') || p.startsWith('ad.') || p === 'vendor.approve',
    ),
  },
  {
    key: 'platform_administrator',
    name: 'Platform Administrator',
    level: 'platform',
    permissions: [
      'platform.estate.approve',
      'platform.estate.create',
      'platform.user.manage',
      'platform.config',
      'vendor.approve',
    ],
  },
  {
    key: 'platform_support_agent',
    name: 'Platform Support Agent',
    level: 'platform',
    permissions: ['platform.user.manage', 'platform.support_access'],
  },
  {
    key: 'platform_finance_officer',
    name: 'Platform Finance Officer',
    level: 'platform',
    permissions: ['platform.finance'],
  },
  {
    key: 'platform_operations_officer',
    name: 'Platform Operations Officer',
    level: 'platform',
    permissions: ['platform.estate.create', 'platform.config'],
  },
  {
    key: 'platform_compliance_officer',
    name: 'Platform Compliance Officer',
    level: 'platform',
    permissions: ['platform.compliance'],
  },
  {
    key: 'advertising_manager',
    name: 'Advertising Manager',
    level: 'platform',
    permissions: ['ad.enquiry.manage', 'ad.campaign.manage'],
  },
  {
    key: 'advertising_reviewer',
    name: 'Advertising Reviewer',
    level: 'platform',
    permissions: ['ad.campaign.review'],
  },

  // Vendor level (marketplace.md §2.3). Held through vendor_members, one role per member.
  { key: 'vendor_owner', name: 'Vendor Owner', level: 'vendor', permissions: VENDOR_PERMISSIONS },
  {
    key: 'vendor_administrator',
    name: 'Vendor Administrator',
    level: 'vendor',
    permissions: [
      'vendor.team.manage',
      'vendor.listing.manage',
      'vendor.order.manage',
      'vendor.order.work',
      'vendor.payout.read',
    ],
  },
  {
    key: 'vendor_employee',
    name: 'Vendor Employee',
    level: 'vendor',
    permissions: ['vendor.listing.manage', 'vendor.order.manage', 'vendor.order.work'],
  },
  {
    key: 'vendor_service_personnel',
    name: 'Vendor Service Personnel',
    level: 'vendor',
    permissions: ['vendor.order.work'],
  },
  // Advertiser levels: permissions are added when the advertising module lands (Phase 4).
  { key: 'advertiser', name: 'Advertiser', level: 'advertiser', permissions: [] },
  {
    key: 'advertiser_organisation_owner',
    name: 'Advertiser Organisation Owner',
    level: 'advertiser',
    permissions: [],
  },
  {
    key: 'advertiser_account_manager',
    name: 'Advertiser Account Manager',
    level: 'advertiser',
    permissions: [],
  },
  {
    key: 'advertising_agency_representative',
    name: 'Advertising Agency Representative',
    level: 'advertiser',
    permissions: [],
  },
];

export function getRole(key: string): RoleDefinition | undefined {
  return BUILT_IN_ROLES.find((role) => role.key === key);
}

/** Union of permissions granted by a set of role keys (unknown keys are ignored). */
export function permissionsForRoles(roleKeys: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const key of roleKeys) {
    for (const permission of getRole(key)?.permissions ?? []) granted.add(permission);
  }
  return granted;
}

export function hasPermission(roleKeys: readonly string[], permission: Permission): boolean {
  return permissionsForRoles(roleKeys).has(permission);
}

/**
 * Estate roles held by residents and owners. Every other estate role is a staff role.
 * Staff and platform roles must use TOTP MFA (identity.md §6.4).
 */
export const RESIDENT_ROLE_KEYS: readonly string[] = [
  'resident',
  'homeowner',
  'tenant',
  'household_member',
  'property_owner',
];

/** True when any of the roles is a platform role or an estate staff role. Unknown keys count as staff. */
/**
 * The ceiling of a guard PIN session on a shared gate device (ADR-0017): only these, and only those the
 * guard already holds, in the device's own estate.
 */
export const GATE_SESSION_PERMISSIONS: readonly Permission[] = [
  'gate.verify',
  'incident.report',
  'sos.trigger',
  'sos.respond',
];

/**
 * What a Techguard agent may do inside an estate during an approved support session (platform.md §4):
 * read-only and never `pii.view`, so phone numbers stay masked. Only GET requests are allowed.
 */
export const SUPPORT_SESSION_PERMISSIONS: readonly Permission[] = [
  'audit.read',
  'invoice.read',
  'report.read',
  'resident.read',
  'visitor.log.read',
];

export function requiresMfa(roleKeys: readonly string[]): boolean {
  return roleKeys.some((key) => {
    const role = getRole(key);
    if (!role) return true;
    if (role.level === 'platform') return true;
    return role.level === 'estate' && !RESIDENT_ROLE_KEYS.includes(key);
  });
}
