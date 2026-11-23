import { Injectable } from '@nestjs/common';
import type {
  clockInSchema,
  clockOutSchema,
  createDepartmentSchema,
  createDutyAssignmentSchema,
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  createPayrollExportSchema,
  createSalaryRecordSchema,
  createStaffProfileSchema,
  createStaffRosterSchema,
  editAttendanceSchema,
  leaveDecisionSchema,
  offboardStaffSchema,
  updateDepartmentSchema,
  updateStaffProfileSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { KeyVault } from '../../integrations/keys/key-vault';
import { dateOnly, daysInclusive, parseDateOnly, toKobo } from '../billing/domain/billing';
import { TenancyService } from '../tenancy/tenancy.service';
import { buildPayrollCsv, computeSalaryTotals, type SalaryPayload } from './domain/workforce';

/**
 * Workforce & HR (workforce.md, Phase 5; ADR-0026).
 * Manages departments, staff profiles, duties, rosters, attendance, leave, encrypted salary records
 * (strictly gated by `payroll.view`), payroll CSV exports and automated offboarding.
 */
@Injectable()
export class WorkforceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly keyVault: KeyVault,
    private readonly tenancy: TenancyService,
  ) {}

  // ---- Departments ------------------------------------------------------------------------------

  async listDepartments(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.department.findMany({
        where: { estateId: access.estateId },
        orderBy: { name: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        headStaffId: r.headStaffId,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createDepartment(access: EstateAccess, input: z.infer<typeof createDepartmentSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.department.findUnique({
        where: { estateId_name: { estateId: access.estateId, name: input.name } },
      });
      if (existing) throw new ConflictError('DEPARTMENT_EXISTS', 'Department name already exists');
      const row = await tx.department.create({
        data: {
          estateId: access.estateId,
          name: input.name,
          headStaffId: input.headStaffId ?? null,
        },
      });
      return {
        id: row.id,
        name: row.name,
        headStaffId: row.headStaffId,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async updateDepartment(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateDepartmentSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.department.findFirst({ where: { estateId: access.estateId, id } });
      if (!existing) throw new NotFoundError('Department not found', 'DEPARTMENT_NOT_FOUND');
      const row = await tx.department.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.headStaffId !== undefined ? { headStaffId: input.headStaffId } : {}),
        },
      });
      return {
        id: row.id,
        name: row.name,
        headStaffId: row.headStaffId,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ---- Staff Profiles & Offboarding -------------------------------------------------------------

  async listStaffProfiles(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.staffProfile.findMany({
        where: { estateId: access.estateId },
        include: { department: { select: { name: true } } },
        orderBy: { staffNumber: 'asc' },
      });
      return rows.map((r) => this.profileView(r));
    });
  }

  async createStaffProfile(access: EstateAccess, input: z.infer<typeof createStaffProfileSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.staffProfile.findFirst({
        where: {
          estateId: access.estateId,
          OR: [{ userId: input.userId }, { staffNumber: input.staffNumber }],
        },
      });
      if (existing) {
        throw new ConflictError(
          'STAFF_PROFILE_EXISTS',
          'A staff profile already exists for this user or staff number',
        );
      }
      const row = await tx.staffProfile.create({
        data: {
          estateId: access.estateId,
          userId: input.userId,
          staffNumber: input.staffNumber,
          departmentId: input.departmentId ?? null,
          jobTitle: input.jobTitle,
          employmentType: input.employmentType,
          startDate: parseDateOnly(input.startDate),
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
        },
        include: { department: { select: { name: true } } },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'workforce.staff.onboarded',
          estateId: access.estateId,
          aggregateType: 'staff_profile',
          aggregateId: row.id,
          payload: { staffId: row.id, userId: row.userId, staffNumber: row.staffNumber },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'workforce.staff.onboard',
            resourceType: 'staff_profile',
            resourceId: row.id,
          },
        },
      ]);
      return this.profileView(row);
    });
  }

  async updateStaffProfile(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateStaffProfileSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, id },
      });
      if (!existing) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      if (existing.status === 'offboarded') {
        throw new ConflictError('STAFF_OFFBOARDED', 'Offboarded staff profiles cannot be modified');
      }
      const row = await tx.staffProfile.update({
        where: { id },
        data: {
          ...(input.staffNumber !== undefined ? { staffNumber: input.staffNumber } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
          ...(input.startDate !== undefined ? { startDate: parseDateOnly(input.startDate) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.emergencyContactName !== undefined
            ? { emergencyContactName: input.emergencyContactName }
            : {}),
          ...(input.emergencyContactPhone !== undefined
            ? { emergencyContactPhone: input.emergencyContactPhone }
            : {}),
        },
        include: { department: { select: { name: true } } },
      });
      return this.profileView(row);
    });
  }

  /**
   * Offboards a staff member (workforce.md §4 rule 2, §7): marks offboarded, suspends estate
   * membership, revokes all active estate role assignments, and revokes all user sessions/devices.
   */
  async offboardStaff(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof offboardStaffSchema>,
  ) {
    const profile = await this.db.withTenant(access, async (tx) => {
      const existing = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, id },
      });
      if (!existing) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      if (existing.userId === access.userId) {
        throw new DomainError('CANNOT_OFFBOARD_SELF', 'You cannot offboard yourself', 403);
      }
      const updated = await tx.staffProfile.update({
        where: { id },
        data: { status: 'offboarded', endDate: parseDateOnly(input.endDate) },
        include: { department: { select: { name: true } } },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'workforce.staff.offboarded',
          estateId: access.estateId,
          aggregateType: 'staff_profile',
          aggregateId: updated.id,
          payload: { staffId: updated.id, userId: updated.userId, endDate: input.endDate },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'workforce.staff.offboard',
            resourceType: 'staff_profile',
            resourceId: updated.id,
            reason: input.reason,
          },
        },
      ]);
      return updated;
    });

    // Suspend membership, revoke all estate roles, and revoke active sessions across devices.
    await this.tenancy
      .setStaffMembershipStatus(access, profile.userId, 'suspended', input.reason)
      .catch(() => {
        /* membership may already be inactive */
      });
    await this.db.withContext('authz', async (tx) => {
      await tx.roleAssignment.updateMany({
        where: { estateId: access.estateId, userId: profile.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.db.withContext('identity', async (tx) => {
      await tx.session.updateMany({
        where: { userId: profile.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return this.profileView(profile);
  }

  // ---- Duties & Rosters -------------------------------------------------------------------------

  async listDutyAssignments(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.dutyAssignment.findMany({
        where: { estateId: access.estateId },
        orderBy: { validFrom: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        staffId: r.staffId,
        description: r.description,
        spaceIds: r.spaceIds,
        validFrom: dateOnly(r.validFrom),
        validTo: r.validTo ? dateOnly(r.validTo) : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createDutyAssignment(
    access: EstateAccess,
    input: z.infer<typeof createDutyAssignmentSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const staff = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, id: input.staffId },
      });
      if (!staff) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      const row = await tx.dutyAssignment.create({
        data: {
          estateId: access.estateId,
          staffId: staff.id,
          description: input.description,
          spaceIds: input.spaceIds,
          validFrom: parseDateOnly(input.validFrom),
          validTo: input.validTo ? parseDateOnly(input.validTo) : null,
        },
      });
      return {
        id: row.id,
        staffId: row.staffId,
        description: row.description,
        spaceIds: row.spaceIds,
        validFrom: dateOnly(row.validFrom),
        validTo: row.validTo ? dateOnly(row.validTo) : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async listRosters(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.staffRoster.findMany({
        where: { estateId: access.estateId },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        staffId: r.staffId,
        date: dateOnly(r.date),
        startTime: r.startTime,
        endTime: r.endTime,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createRoster(access: EstateAccess, input: z.infer<typeof createStaffRosterSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const staff = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, id: input.staffId },
      });
      if (!staff) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      const row = await tx.staffRoster.create({
        data: {
          estateId: access.estateId,
          staffId: staff.id,
          date: parseDateOnly(input.date),
          startTime: input.startTime,
          endTime: input.endTime,
          notes: input.notes ?? null,
        },
      });
      return {
        id: row.id,
        staffId: row.staffId,
        date: dateOnly(row.date),
        startTime: row.startTime,
        endTime: row.endTime,
        notes: row.notes,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ---- Attendance -------------------------------------------------------------------------------

  async listAttendance(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const isManager = access.permissions.has('workforce.manage');
      const own = isManager
        ? null
        : await tx.staffProfile.findFirst({
            where: { estateId: access.estateId, userId: access.userId },
          });
      if (!isManager && !own) return [];
      const rows = await tx.attendanceRecord.findMany({
        where: {
          estateId: access.estateId,
          ...(own ? { staffId: own.id } : {}),
        },
        orderBy: { clockIn: 'desc' },
        take: 200,
      });
      return rows.map((r) => this.attendanceView(r));
    });
  }

  async clockIn(access: EstateAccess, input: z.infer<typeof clockInSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const staff = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, userId: access.userId, status: 'active' },
      });
      if (!staff)
        throw new NotFoundError('Active staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      const open = await tx.attendanceRecord.findFirst({
        where: { estateId: access.estateId, staffId: staff.id, clockOut: null },
      });
      if (open) throw new ConflictError('ALREADY_CLOCKED_IN', 'You are already clocked in');
      const row = await tx.attendanceRecord.create({
        data: {
          estateId: access.estateId,
          staffId: staff.id,
          clockIn: new Date(),
          source: 'app',
          geoOk: input.geoOk,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'workforce.attendance.recorded',
          estateId: access.estateId,
          aggregateType: 'attendance_record',
          aggregateId: row.id,
          payload: { staffId: staff.id, action: 'clock_in', source: 'app' },
        },
      ]);
      return this.attendanceView(row);
    });
  }

  async clockOut(access: EstateAccess, _input: z.infer<typeof clockOutSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const staff = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, userId: access.userId },
      });
      if (!staff) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      const open = await tx.attendanceRecord.findFirst({
        where: { estateId: access.estateId, staffId: staff.id, clockOut: null },
        orderBy: { clockIn: 'desc' },
      });
      if (!open)
        throw new ConflictError('NOT_CLOCKED_IN', 'No open attendance record to clock out');
      const row = await tx.attendanceRecord.update({
        where: { id: open.id },
        data: { clockOut: new Date() },
      });
      return this.attendanceView(row);
    });
  }

  async editAttendance(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof editAttendanceSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.attendanceRecord.findFirst({
        where: { estateId: access.estateId, id },
      });
      if (!existing) throw new NotFoundError('Attendance record not found', 'ATTENDANCE_NOT_FOUND');
      const row = await tx.attendanceRecord.update({
        where: { id },
        data: {
          ...(input.clockIn ? { clockIn: new Date(input.clockIn) } : {}),
          ...(input.clockOut ? { clockOut: new Date(input.clockOut) } : {}),
          approvedBy: access.userId,
          editedReason: input.reason,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'workforce.attendance.edited',
          estateId: access.estateId,
          aggregateType: 'attendance_record',
          aggregateId: row.id,
          payload: { attendanceId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'workforce.attendance.edit',
            resourceType: 'attendance_record',
            resourceId: row.id,
            reason: input.reason,
          },
        },
      ]);
      return this.attendanceView(row);
    });
  }

  // ---- Leave ------------------------------------------------------------------------------------

  async listLeaveTypes(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.leaveType.findMany({
        where: { estateId: access.estateId },
        orderBy: { name: 'asc' },
      });
      return rows;
    });
  }

  async createLeaveType(access: EstateAccess, input: z.infer<typeof createLeaveTypeSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.leaveType.findUnique({
        where: { estateId_name: { estateId: access.estateId, name: input.name } },
      });
      if (existing) throw new ConflictError('LEAVE_TYPE_EXISTS', 'Leave type already exists');
      return tx.leaveType.create({
        data: {
          estateId: access.estateId,
          name: input.name,
          annualAllowanceDays: input.annualAllowanceDays,
          paid: input.paid,
        },
      });
    });
  }

  async listLeaveRequests(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const canApprove =
        access.permissions.has('workforce.leave.approve') ||
        access.permissions.has('workforce.manage');
      const own = canApprove
        ? null
        : await tx.staffProfile.findFirst({
            where: { estateId: access.estateId, userId: access.userId },
          });
      if (!canApprove && !own) return [];
      const rows = await tx.leaveRequest.findMany({
        where: { estateId: access.estateId, ...(own ? { staffId: own.id } : {}) },
        include: { leaveType: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => this.leaveView(r));
    });
  }

  async createLeaveRequest(access: EstateAccess, input: z.infer<typeof createLeaveRequestSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const staff = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, userId: access.userId, status: { not: 'offboarded' } },
      });
      if (!staff) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      const leaveType = await tx.leaveType.findFirst({
        where: { estateId: access.estateId, id: input.leaveTypeId },
      });
      if (!leaveType) throw new NotFoundError('Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
      const days = daysInclusive(input.startsOn, input.endsOn);
      const row = await tx.leaveRequest.create({
        data: {
          estateId: access.estateId,
          staffId: staff.id,
          leaveTypeId: leaveType.id,
          startsOn: parseDateOnly(input.startsOn),
          endsOn: parseDateOnly(input.endsOn),
          days,
          reason: input.reason,
          status: 'pending',
        },
        include: { leaveType: { select: { name: true } } },
      });
      return this.leaveView(row);
    });
  }

  async decideLeaveRequest(
    access: EstateAccess,
    id: string,
    decision: 'approved' | 'rejected',
    input: z.infer<typeof leaveDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const req = await tx.leaveRequest.findFirst({
        where: { estateId: access.estateId, id },
        include: { staff: true, leaveType: { select: { name: true } } },
      });
      if (!req) throw new NotFoundError('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
      if (req.status !== 'pending') {
        throw new ConflictError('LEAVE_NOT_PENDING', 'Leave request has already been decided');
      }
      if (req.staff.userId === access.userId) {
        throw new DomainError(
          'SELF_APPROVAL_FORBIDDEN',
          'You cannot approve your own leave request',
          403,
        );
      }
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: decision,
          decidedBy: access.userId,
          decidedAt: new Date(),
          comment: input.comment ?? null,
        },
        include: { leaveType: { select: { name: true } } },
      });
      if (decision === 'approved') {
        await appendOutboxEvents(tx, [
          {
            type: 'workforce.leave.approved',
            estateId: access.estateId,
            aggregateType: 'leave_request',
            aggregateId: updated.id,
            payload: { leaveRequestId: updated.id, staffId: updated.staffId, days: updated.days },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'workforce.leave.approve',
              resourceType: 'leave_request',
              resourceId: updated.id,
            },
          },
        ]);
      }
      return this.leaveView(updated);
    });
  }

  // ---- Salary & Payroll (strictly payroll.view) -------------------------------------------------

  async listSalaryRecords(access: EstateAccess, staffId?: string) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.salaryRecord.findMany({
        where: { estateId: access.estateId, ...(staffId ? { staffId } : {}) },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      return rows.map((r) => this.salaryView(r));
    });
  }

  async createSalaryRecord(access: EstateAccess, input: z.infer<typeof createSalaryRecordSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const staff = await tx.staffProfile.findFirst({
        where: { estateId: access.estateId, id: input.staffId },
      });
      if (!staff) throw new NotFoundError('Staff profile not found', 'STAFF_PROFILE_NOT_FOUND');
      const payload: SalaryPayload = {
        basicKobo: input.basicKobo,
        allowances: input.allowances,
        deductions: input.deductions,
      };
      const encrypted = this.keyVault.wrap(Buffer.from(JSON.stringify(payload), 'utf8'));
      const row = await tx.salaryRecord.create({
        data: {
          estateId: access.estateId,
          staffId: staff.id,
          payloadEncrypted: encrypted,
          effectiveFrom: parseDateOnly(input.effectiveFrom),
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'workforce.salary.recorded',
          estateId: access.estateId,
          aggregateType: 'salary_record',
          aggregateId: row.id,
          payload: { staffId: staff.id, effectiveFrom: input.effectiveFrom },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'workforce.salary.create',
            resourceType: 'salary_record',
            resourceId: row.id,
          },
        },
      ]);
      return this.salaryView(row);
    });
  }

  async listPayrollExports(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.payrollExport.findMany({
        where: { estateId: access.estateId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map((r) => ({
        id: r.id,
        period: r.period,
        staffCount: r.staffCount,
        totalNetKobo: toKobo(r.totalNetKobo),
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        csv: r.csvContent,
      }));
    });
  }

  async generatePayrollExport(
    access: EstateAccess,
    input: z.infer<typeof createPayrollExportSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const staffList = await tx.staffProfile.findMany({
        where: { estateId: access.estateId, status: { in: ['active', 'on_leave'] } },
        include: {
          salaries: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 1 },
        },
        orderBy: { staffNumber: 'asc' },
      });
      const csvRows = [];
      let totalNet = 0;
      for (const s of staffList) {
        const latest = s.salaries[0];
        if (!latest) continue;
        const payload = JSON.parse(
          this.keyVault.unwrap(latest.payloadEncrypted).toString('utf8'),
        ) as SalaryPayload;
        const totals = computeSalaryTotals(payload);
        totalNet += totals.netKobo;
        csvRows.push({
          staffNumber: s.staffNumber,
          jobTitle: s.jobTitle,
          basicKobo: payload.basicKobo,
          grossKobo: totals.grossKobo,
          deductionsKobo: totals.deductionsKobo,
          netKobo: totals.netKobo,
        });
      }
      const csv = buildPayrollCsv(input.period, csvRows);
      const row = await tx.payrollExport.create({
        data: {
          estateId: access.estateId,
          period: input.period,
          staffCount: csvRows.length,
          totalNetKobo: BigInt(totalNet),
          csvContent: csv,
          createdBy: access.userId,
        },
      });
      return {
        id: row.id,
        period: row.period,
        staffCount: row.staffCount,
        totalNetKobo: toKobo(row.totalNetKobo),
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        csv: row.csvContent,
      };
    });
  }

  // ---- View helpers -----------------------------------------------------------------------------

  private profileView(r: {
    id: string;
    userId: string;
    staffNumber: string;
    departmentId: string | null;
    department: { name: string } | null;
    jobTitle: string;
    employmentType: string;
    startDate: Date;
    endDate: Date | null;
    status: string;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      userId: r.userId,
      staffNumber: r.staffNumber,
      departmentId: r.departmentId,
      departmentName: r.department?.name ?? null,
      jobTitle: r.jobTitle,
      employmentType: r.employmentType as 'full_time' | 'part_time' | 'contract',
      startDate: dateOnly(r.startDate),
      endDate: r.endDate ? dateOnly(r.endDate) : null,
      status: r.status as 'active' | 'on_leave' | 'suspended' | 'offboarded',
      emergencyContactName: r.emergencyContactName,
      emergencyContactPhone: r.emergencyContactPhone,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private attendanceView(r: {
    id: string;
    staffId: string;
    clockIn: Date;
    clockOut: Date | null;
    source: string;
    geoOk: boolean;
    approvedBy: string | null;
    editedReason: string | null;
  }) {
    return {
      id: r.id,
      staffId: r.staffId,
      clockIn: r.clockIn.toISOString(),
      clockOut: r.clockOut ? r.clockOut.toISOString() : null,
      source: r.source as 'app' | 'security_shift' | 'manual',
      geoOk: r.geoOk,
      approvedBy: r.approvedBy,
      editedReason: r.editedReason,
      durationMinutes: r.clockOut
        ? Math.max(0, Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60_000))
        : null,
    };
  }

  private leaveView(r: {
    id: string;
    staffId: string;
    leaveTypeId: string;
    leaveType: { name: string };
    startsOn: Date;
    endsOn: Date;
    days: number;
    reason: string;
    status: string;
    decidedBy: string | null;
    decidedAt: Date | null;
    comment: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      staffId: r.staffId,
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveType.name,
      startsOn: dateOnly(r.startsOn),
      endsOn: dateOnly(r.endsOn),
      days: r.days,
      reason: r.reason,
      status: r.status as 'pending' | 'approved' | 'rejected' | 'cancelled',
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private salaryView(r: {
    id: string;
    staffId: string;
    payloadEncrypted: string;
    effectiveFrom: Date;
    createdAt: Date;
  }) {
    const payload = JSON.parse(
      this.keyVault.unwrap(r.payloadEncrypted).toString('utf8'),
    ) as SalaryPayload;
    const totals = computeSalaryTotals(payload);
    return {
      id: r.id,
      staffId: r.staffId,
      basicKobo: payload.basicKobo,
      allowances: [...payload.allowances],
      deductions: [...payload.deductions],
      grossKobo: totals.grossKobo,
      netKobo: totals.netKobo,
      effectiveFrom: dateOnly(r.effectiveFrom),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
