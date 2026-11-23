import { z } from 'zod';

const wfDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const wfTimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
const nonNegativeKoboSchema = z.number().int().nonnegative();

// ---- Departments --------------------------------------------------------------------------------

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  headStaffId: z.uuid().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  headStaffId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Staff Profiles -----------------------------------------------------------------------------

export const employmentTypeSchema = z.enum(['full_time', 'part_time', 'contract']);
export const staffProfileStatusSchema = z.enum(['active', 'on_leave', 'suspended', 'offboarded']);

export const createStaffProfileSchema = z.object({
  userId: z.uuid(),
  staffNumber: z.string().trim().min(2).max(60),
  departmentId: z.uuid().optional(),
  jobTitle: z.string().trim().min(2).max(120),
  employmentType: employmentTypeSchema.default('full_time'),
  startDate: wfDateSchema,
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
});

export const updateStaffProfileSchema = createStaffProfileSchema
  .omit({ userId: true })
  .partial()
  .extend({
    status: z.enum(['active', 'on_leave', 'suspended']).optional(),
  });

export const offboardStaffSchema = z.object({
  endDate: wfDateSchema,
  reason: z.string().trim().min(3).max(400),
});

export const staffProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  staffNumber: z.string(),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  jobTitle: z.string(),
  employmentType: employmentTypeSchema,
  startDate: wfDateSchema,
  endDate: wfDateSchema.nullable(),
  status: staffProfileStatusSchema,
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Duty Assignments & Rosters -----------------------------------------------------------------

export const createDutyAssignmentSchema = z.object({
  staffId: z.uuid(),
  description: z.string().trim().min(3).max(300),
  spaceIds: z.array(z.uuid()).default([]),
  validFrom: wfDateSchema,
  validTo: wfDateSchema.optional(),
});

export const dutyAssignmentSchema = z.object({
  id: z.uuid(),
  staffId: z.uuid(),
  description: z.string(),
  spaceIds: z.array(z.uuid()),
  validFrom: wfDateSchema,
  validTo: wfDateSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const createStaffRosterSchema = z.object({
  staffId: z.uuid(),
  date: wfDateSchema,
  startTime: wfTimeSchema,
  endTime: wfTimeSchema,
  notes: z.string().trim().max(300).optional(),
});

export const staffRosterSchema = z.object({
  id: z.uuid(),
  staffId: z.uuid(),
  date: wfDateSchema,
  startTime: z.string(),
  endTime: z.string(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Attendance ---------------------------------------------------------------------------------

export const attendanceSourceSchema = z.enum(['app', 'security_shift', 'manual']);

export const clockInSchema = z.object({
  geoOk: z.boolean().default(true),
  notes: z.string().trim().max(300).optional(),
});

export const clockOutSchema = z.object({
  notes: z.string().trim().max(300).optional(),
});

export const editAttendanceSchema = z.object({
  clockIn: z.iso.datetime().optional(),
  clockOut: z.iso.datetime().optional(),
  reason: z.string().trim().min(3).max(300),
});

export const attendanceRecordSchema = z.object({
  id: z.uuid(),
  staffId: z.uuid(),
  clockIn: z.iso.datetime(),
  clockOut: z.iso.datetime().nullable(),
  source: attendanceSourceSchema,
  geoOk: z.boolean(),
  approvedBy: z.uuid().nullable(),
  editedReason: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
});

// ---- Leave --------------------------------------------------------------------------------------

export const leaveRequestStatusSchema = z.enum(['pending', 'approved', 'rejected', 'cancelled']);

export const createLeaveTypeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  annualAllowanceDays: z.number().int().min(1).max(365),
  paid: z.boolean().default(true),
});

export const leaveTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  annualAllowanceDays: z.number().int(),
  paid: z.boolean(),
});

export const createLeaveRequestSchema = z
  .object({
    leaveTypeId: z.uuid(),
    startsOn: wfDateSchema,
    endsOn: wfDateSchema,
    reason: z.string().trim().min(3).max(400),
  })
  .refine((v) => v.endsOn >= v.startsOn, 'Leave end date must be on or after start date');

export const leaveDecisionSchema = z.object({
  comment: z.string().trim().max(300).optional(),
});

export const leaveRequestSchema = z.object({
  id: z.uuid(),
  staffId: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveTypeName: z.string(),
  startsOn: wfDateSchema,
  endsOn: wfDateSchema,
  days: z.number().int(),
  reason: z.string(),
  status: leaveRequestStatusSchema,
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Salary & Payroll (strictly payroll.view) ---------------------------------------------------

export const moneyLineSchema = z.object({
  label: z.string().trim().min(1).max(80),
  amountKobo: nonNegativeKoboSchema,
});

export const createSalaryRecordSchema = z.object({
  staffId: z.uuid(),
  basicKobo: nonNegativeKoboSchema,
  allowances: z.array(moneyLineSchema).default([]),
  deductions: z.array(moneyLineSchema).default([]),
  effectiveFrom: wfDateSchema,
});

export const salaryRecordSchema = z.object({
  id: z.uuid(),
  staffId: z.uuid(),
  basicKobo: nonNegativeKoboSchema,
  allowances: z.array(moneyLineSchema),
  deductions: z.array(moneyLineSchema),
  grossKobo: nonNegativeKoboSchema,
  netKobo: z.number().int(),
  effectiveFrom: wfDateSchema,
  createdAt: z.iso.datetime(),
});

export const createPayrollExportSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
});

export const payrollExportSchema = z.object({
  id: z.uuid(),
  period: z.string(),
  staffCount: z.number().int(),
  totalNetKobo: z.number().int(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  csv: z.string().optional(),
});
