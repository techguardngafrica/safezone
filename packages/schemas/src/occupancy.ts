import { z } from 'zod';
import { phoneE164Schema } from './common';

/** Occupancy (occupancy.md): households, join requests, vehicles, domestic staff, emergency contacts. */
export const joinRelationshipSchema = z.enum(['owner', 'tenant', 'household_member']);
export const joinStatusSchema = z.enum([
  'awaiting_household_head',
  'awaiting_owner',
  'awaiting_manager',
  'approved',
  'rejected',
  'cancelled',
  'expired',
]);

export const joinCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z2-9]{6}$/, 'Enter the 6-character estate code'),
});
export const joinEstateSchema = z.object({ id: z.uuid(), name: z.string() });
export const joinUnitsQuerySchema = z.object({ q: z.string().trim().min(1).max(40) });
export const joinUnitSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const createJoinRequestSchema = z.object({
  estateId: z.uuid(),
  spaceId: z.uuid(),
  relationship: joinRelationshipSchema,
  fullName: z.string().trim().min(2).max(120),
  message: z.string().trim().max(500).optional(),
  evidenceFileIds: z.array(z.uuid()).max(5).default([]),
});

export const joinRequestSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid(),
  userId: z.uuid(),
  fullName: z.string(),
  unit: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  relationship: joinRelationshipSchema,
  householdId: z.uuid().nullable(),
  message: z.string().nullable(),
  status: joinStatusSchema,
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
});
export const joinRequestListQuerySchema = z.object({
  status: joinStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export const joinDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});
export const joinRejectionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const memberPermissionsSchema = z.object({
  inviteVisitors: z.boolean(),
  triggerSos: z.boolean(),
  payBills: z.boolean(),
  viewBills: z.boolean(),
  receiveGateAlerts: z.boolean(),
});
export const memberRelationshipSchema = z.enum([
  'head',
  'spouse',
  'child',
  'relative',
  'tenant_co_occupant',
  'other',
]);
export const householdMemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  fullName: z.string(),
  relationship: memberRelationshipSchema,
  isMinor: z.boolean(),
  permissions: memberPermissionsSchema,
  joinedAt: z.iso.datetime(),
});
export const householdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['active', 'ended']),
  headUserId: z.uuid(),
  unit: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  occupancy: z
    .object({
      id: z.uuid(),
      type: z.enum(['owner_occupier', 'tenant', 'other']),
      startsOn: z.iso.date(),
      endsOn: z.iso.date().nullable(),
    })
    .nullable(),
  members: z.array(householdMemberSchema),
});

export const addHouseholdMemberSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    /** Adults with a phone get an app account; minors usually have none. */
    phone: phoneE164Schema.optional(),
    relationship: memberRelationshipSchema.exclude(['head']),
    isMinor: z.boolean().default(false),
    permissions: memberPermissionsSchema.partial().optional(),
  })
  .refine((value) => value.isMinor || value.phone !== undefined, {
    message: 'Adults need a phone number',
    path: ['phone'],
  });
export const updateHouseholdMemberSchema = z
  .object({
    relationship: memberRelationshipSchema.exclude(['head']).optional(),
    permissions: memberPermissionsSchema.partial().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

/** Manager records an occupancy directly (e.g. moving existing residents onto Safezone). */
export const createOccupancySchema = z.object({
  spaceId: z.uuid(),
  type: z.enum(['owner_occupier', 'tenant', 'other']),
  head: z.object({ fullName: z.string().trim().min(2).max(120), phone: phoneE164Schema }),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().optional(),
});
export const endOccupancySchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const residentSchema = z.object({
  userId: z.uuid().nullable(),
  memberId: z.uuid(),
  fullName: z.string(),
  /** Masked unless the viewer has pii.view. */
  phone: z.string().nullable(),
  relationship: memberRelationshipSchema,
  householdId: z.uuid(),
  unit: z.object({ id: z.uuid(), code: z.string() }),
});
export const residentListQuerySchema = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  spaceId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const vehicleSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  plate: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  colour: z.string().nullable(),
  tagNumber: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
});
export const createVehicleSchema = z.object({
  householdId: z.uuid(),
  plate: z.string().trim().min(3).max(15),
  make: z.string().trim().max(40).optional(),
  model: z.string().trim().max(40).optional(),
  colour: z.string().trim().max(30).optional(),
  tagNumber: z.string().trim().max(30).optional(),
});
export const vehicleLookupQuerySchema = z.object({ plate: z.string().trim().min(3).max(15) });
/** What a guard sees for a plate: minimum data (AGENTS.md §6.5). */
export const vehicleLookupSchema = z.object({
  plate: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  colour: z.string().nullable(),
  unitCode: z.string(),
  householdName: z.string(),
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const staffScheduleSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: timeSchema,
  to: timeSchema,
});
export const domesticStaffSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  role: z.enum(['cleaner', 'driver', 'nanny', 'security', 'cook', 'gardener', 'other']),
  schedule: staffScheduleSchema,
  status: z.enum(['pending', 'active', 'suspended', 'ended']),
});
export const createDomesticStaffSchema = z.object({
  householdId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  phone: phoneE164Schema.optional(),
  role: domesticStaffSchema.shape.role,
  schedule: staffScheduleSchema,
});
export const domesticStaffStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'ended']),
});

export const emergencyContactSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  relationship: z.string(),
  consentConfirmedAt: z.iso.datetime(),
});
export const createEmergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneE164Schema,
  relationship: z.string().trim().min(2).max(40),
  /** The user confirms the contact agreed to be called in an emergency (occupancy.md §6.7). */
  consentConfirmed: z.literal(true),
});

export const estateItemParamsSchema = z.object({ estateId: z.uuid(), id: z.uuid() });

// ---- Move-in and move-out (occupancy.md §5, Phase 2) --------------------------------------------

export const moveTypeSchema = z.enum(['move_in', 'move_out']);
export const gateNoticeSchema = z.object({
  /** e.g. "1 truck, furniture" (shown to guards on the day). */
  items: z.string().trim().max(300).optional(),
  vehicles: z.array(z.string().trim().min(3).max(15)).max(5).default([]),
  notes: z.string().trim().max(500).optional(),
});
export const createMoveSchema = z.object({
  type: moveTypeSchema,
  occupancyId: z.uuid(),
  scheduledOn: z.iso.date(),
  gateNotice: gateNoticeSchema.default({ vehicles: [] }),
});
export const moveChecklistSchema = z.object({
  items: z.array(z.object({ item: z.string().trim().min(2).max(120), done: z.boolean() })).max(30),
});
export const moveSchema = z.object({
  id: z.uuid(),
  type: moveTypeSchema,
  occupancyId: z.uuid(),
  spaceId: z.uuid(),
  unitCode: z.string(),
  scheduledOn: z.iso.date(),
  gateNotice: gateNoticeSchema,
  checklist: z.array(z.object({ item: z.string(), done: z.boolean() })),
  status: z.enum(['scheduled', 'completed', 'cancelled']),
  /** Open balance on the unit when the move was scheduled (a warning; estates decide if it blocks). */
  outstandingBalance: z.number().int(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export const moveListQuerySchema = z.object({
  /** Guards: moves on this day (WAT). */
  on: z.iso.date().optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
});
export const renewOccupancySchema = z.object({ endsOn: z.iso.date() });
