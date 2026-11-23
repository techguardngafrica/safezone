import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  attendanceRecordSchema,
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
  departmentSchema,
  dutyAssignmentSchema,
  editAttendanceSchema,
  estateParamSchema,
  leaveDecisionSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  offboardStaffSchema,
  payrollExportSchema,
  salaryRecordSchema,
  staffProfileSchema,
  staffRosterSchema,
  updateDepartmentSchema,
  updateStaffProfileSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { WorkforceService } from './workforce.service';

const itemParamSchema = estateParamSchema.extend({ id: z.uuid() });
const salaryQuerySchema = z.object({ staffId: z.uuid().optional() });

@Controller('v1/estates/:estateId')
export class WorkforceController {
  constructor(private readonly workforce: WorkforceService) {}

  // ---- Departments ------------------------------------------------------------------------------

  @Get('departments')
  @Can('workforce.manage', 'role.assign')
  @Contract({
    summary: 'List estate departments',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(departmentSchema),
  })
  listDepartments(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listDepartments(estate);
  }

  @Post('departments')
  @Can('workforce.manage')
  @Contract({
    summary: 'Create a department',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createDepartmentSchema,
    response: departmentSchema,
    status: 201,
    errors: [409],
  })
  createDepartment(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createDepartmentSchema>,
  ) {
    return this.workforce.createDepartment(estate, body);
  }

  @Patch('departments/:id')
  @Can('workforce.manage')
  @Contract({
    summary: 'Update a department',
    tags: ['workforce'],
    params: itemParamSchema,
    body: updateDepartmentSchema,
    response: departmentSchema,
    errors: [404],
  })
  updateDepartment(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof updateDepartmentSchema>,
  ) {
    return this.workforce.updateDepartment(estate, params.id, body);
  }

  // ---- Staff Profiles & Offboarding -------------------------------------------------------------

  @Get('workforce/profiles')
  @Can('workforce.manage', 'role.assign')
  @Contract({
    summary: 'List estate employee profiles',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(staffProfileSchema),
  })
  listStaffProfiles(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listStaffProfiles(estate);
  }

  @Post('workforce/profiles')
  @Can('workforce.manage')
  @Contract({
    summary: 'Create an employee profile',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createStaffProfileSchema,
    response: staffProfileSchema,
    status: 201,
    errors: [409],
  })
  createStaffProfile(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createStaffProfileSchema>,
  ) {
    return this.workforce.createStaffProfile(estate, body);
  }

  @Patch('workforce/profiles/:id')
  @Can('workforce.manage')
  @Contract({
    summary: 'Update an employee profile',
    tags: ['workforce'],
    params: itemParamSchema,
    body: updateStaffProfileSchema,
    response: staffProfileSchema,
    errors: [404, 409],
  })
  updateStaffProfile(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof updateStaffProfileSchema>,
  ) {
    return this.workforce.updateStaffProfile(estate, params.id, body);
  }

  @Post('workforce/profiles/:id/offboard')
  @Can('workforce.manage')
  @HttpCode(200)
  @Contract({
    summary: 'Offboard a staff member, revoking all estate roles and signing out all devices',
    tags: ['workforce'],
    params: itemParamSchema,
    body: offboardStaffSchema,
    response: staffProfileSchema,
    errors: [403, 404],
  })
  offboardStaff(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof offboardStaffSchema>,
  ) {
    return this.workforce.offboardStaff(estate, params.id, body);
  }

  // ---- Duties & Rosters -------------------------------------------------------------------------

  @Get('duty-assignments')
  @Can('workforce.manage')
  @Contract({
    summary: 'List staff duty assignments',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(dutyAssignmentSchema),
  })
  listDutyAssignments(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listDutyAssignments(estate);
  }

  @Post('duty-assignments')
  @Can('workforce.manage')
  @Contract({
    summary: 'Create a staff duty assignment',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createDutyAssignmentSchema,
    response: dutyAssignmentSchema,
    status: 201,
    errors: [404],
  })
  createDutyAssignment(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createDutyAssignmentSchema>,
  ) {
    return this.workforce.createDutyAssignment(estate, body);
  }

  @Get('staff-rosters')
  @Can('workforce.manage', 'workforce.attendance.log')
  @Contract({
    summary: 'List non-security staff shift rosters',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(staffRosterSchema),
  })
  listRosters(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listRosters(estate);
  }

  @Post('staff-rosters')
  @Can('workforce.manage')
  @Contract({
    summary: 'Schedule a staff roster shift',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createStaffRosterSchema,
    response: staffRosterSchema,
    status: 201,
    errors: [404],
  })
  createRoster(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createStaffRosterSchema>,
  ) {
    return this.workforce.createRoster(estate, body);
  }

  // ---- Attendance -------------------------------------------------------------------------------

  @Get('workforce/attendance')
  @Can('workforce.attendance.log', 'workforce.manage')
  @Contract({
    summary: 'List attendance records (managers see all; staff see own)',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(attendanceRecordSchema),
  })
  listAttendance(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listAttendance(estate);
  }

  @Post('workforce/attendance/clock-in')
  @Can('workforce.attendance.log')
  @Contract({
    summary: 'Clock in for the current staff member',
    tags: ['workforce'],
    params: estateParamSchema,
    body: clockInSchema,
    response: attendanceRecordSchema,
    status: 201,
    errors: [404, 409],
  })
  clockIn(@CurrentEstate() estate: EstateAccess, @ValidBody() body: z.infer<typeof clockInSchema>) {
    return this.workforce.clockIn(estate, body);
  }

  @Post('workforce/attendance/clock-out')
  @Can('workforce.attendance.log')
  @HttpCode(200)
  @Contract({
    summary: 'Clock out for the current staff member',
    tags: ['workforce'],
    params: estateParamSchema,
    body: clockOutSchema,
    response: attendanceRecordSchema,
    errors: [404, 409],
  })
  clockOut(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof clockOutSchema>,
  ) {
    return this.workforce.clockOut(estate, body);
  }

  @Patch('workforce/attendance/:id')
  @Can('workforce.manage')
  @Contract({
    summary: 'Edit an attendance record with an audited reason',
    tags: ['workforce'],
    params: itemParamSchema,
    body: editAttendanceSchema,
    response: attendanceRecordSchema,
    errors: [404],
  })
  editAttendance(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof editAttendanceSchema>,
  ) {
    return this.workforce.editAttendance(estate, params.id, body);
  }

  // ---- Leave ------------------------------------------------------------------------------------

  @Get('leave-types')
  @Can('workforce.leave.request', 'workforce.manage')
  @Contract({
    summary: 'List estate leave types',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(leaveTypeSchema),
  })
  listLeaveTypes(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listLeaveTypes(estate);
  }

  @Post('leave-types')
  @Can('workforce.manage')
  @Contract({
    summary: 'Create a leave type',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createLeaveTypeSchema,
    response: leaveTypeSchema,
    status: 201,
    errors: [409],
  })
  createLeaveType(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createLeaveTypeSchema>,
  ) {
    return this.workforce.createLeaveType(estate, body);
  }

  @Get('leave-requests')
  @Can('workforce.leave.request', 'workforce.leave.approve', 'workforce.manage')
  @Contract({
    summary: 'List leave requests',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(leaveRequestSchema),
  })
  listLeaveRequests(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listLeaveRequests(estate);
  }

  @Post('leave-requests')
  @Can('workforce.leave.request')
  @Contract({
    summary: 'Submit a leave request',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createLeaveRequestSchema,
    response: leaveRequestSchema,
    status: 201,
    errors: [404],
  })
  createLeaveRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createLeaveRequestSchema>,
  ) {
    return this.workforce.createLeaveRequest(estate, body);
  }

  @Post('leave-requests/:id/approve')
  @Can('workforce.leave.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a staff leave request (cannot approve own request)',
    tags: ['workforce'],
    params: itemParamSchema,
    body: leaveDecisionSchema,
    response: leaveRequestSchema,
    errors: [403, 404, 409],
  })
  approveLeaveRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof leaveDecisionSchema>,
  ) {
    return this.workforce.decideLeaveRequest(estate, params.id, 'approved', body);
  }

  @Post('leave-requests/:id/reject')
  @Can('workforce.leave.approve')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a staff leave request',
    tags: ['workforce'],
    params: itemParamSchema,
    body: leaveDecisionSchema,
    response: leaveRequestSchema,
    errors: [403, 404, 409],
  })
  rejectLeaveRequest(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof itemParamSchema>,
    @ValidBody() body: z.infer<typeof leaveDecisionSchema>,
  ) {
    return this.workforce.decideLeaveRequest(estate, params.id, 'rejected', body);
  }

  // ---- Salary & Payroll (strictly payroll.view) -------------------------------------------------

  @Get('salary-records')
  @Can('payroll.view')
  @Contract({
    summary: 'List decrypted staff salary records (requires payroll.view)',
    tags: ['workforce'],
    params: estateParamSchema,
    query: salaryQuerySchema,
    response: z.array(salaryRecordSchema),
  })
  listSalaryRecords(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof salaryQuerySchema>,
  ) {
    return this.workforce.listSalaryRecords(estate, query.staffId);
  }

  @Post('salary-records')
  @Can('payroll.view')
  @Contract({
    summary: 'Record an encrypted staff salary entry (requires payroll.view)',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createSalaryRecordSchema,
    response: salaryRecordSchema,
    status: 201,
    errors: [404],
  })
  createSalaryRecord(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createSalaryRecordSchema>,
  ) {
    return this.workforce.createSalaryRecord(estate, body);
  }

  @Get('payroll-exports')
  @Can('payroll.view')
  @Contract({
    summary: 'List generated payroll CSV exports (requires payroll.view)',
    tags: ['workforce'],
    params: estateParamSchema,
    response: z.array(payrollExportSchema),
  })
  listPayrollExports(@CurrentEstate() estate: EstateAccess) {
    return this.workforce.listPayrollExports(estate);
  }

  @Post('payroll-exports')
  @Can('payroll.view')
  @Contract({
    summary: 'Generate a payroll CSV export for a period (requires payroll.view)',
    tags: ['workforce'],
    params: estateParamSchema,
    body: createPayrollExportSchema,
    response: payrollExportSchema,
    status: 201,
  })
  generatePayrollExport(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createPayrollExportSchema>,
  ) {
    return this.workforce.generatePayrollExport(estate, body);
  }
}
