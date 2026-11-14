import { Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  addMaterialSchema,
  createCommentSchema,
  createMaintenanceCategorySchema,
  createMaintenanceRequestSchema,
  createRecurringMaintenanceSchema,
  createWorkOrderSchema,
  estateItemParamsSchema,
  estateParamSchema,
  maintenanceCategorySchema,
  maintenanceReportQuerySchema,
  maintenanceReportSchema,
  maintenanceRequestDetailSchema,
  maintenanceRequestListQuerySchema,
  maintenanceRequestSchema,
  putSlaPoliciesSchema,
  rateRequestSchema,
  recurringMaintenanceSchema,
  requestReasonSchema,
  requestTransitionSchema,
  slaPolicySchema,
  updateMaintenanceCategorySchema,
  updateWorkOrderSchema,
  workOrderListQuerySchema,
  workOrderSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { MaintenanceService } from './maintenance.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

/** Maintenance requests, complaints and work orders (maintenance.md §6). */
@Controller('v1/estates/:estateId')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('maintenance-categories')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Request and complaint categories',
    tags: ['maintenance'],
    params: estateParamSchema,
    response: z.array(maintenanceCategorySchema),
  })
  categories(@CurrentEstate() estate: EstateAccess) {
    return this.maintenance.categories(estate);
  }

  @Post('maintenance-categories')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Add a category',
    tags: ['maintenance'],
    params: estateParamSchema,
    body: createMaintenanceCategorySchema,
    response: maintenanceCategorySchema,
    status: 201,
    errors: [403, 409],
  })
  createCategory(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createMaintenanceCategorySchema>,
  ) {
    return this.maintenance.createCategory(estate, body);
  }

  @Patch('maintenance-categories/:id')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Rename, re-prioritise or retire a category',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: updateMaintenanceCategorySchema,
    response: maintenanceCategorySchema,
    errors: [403, 404],
  })
  updateCategory(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateMaintenanceCategorySchema>,
  ) {
    return this.maintenance.updateCategory(estate, params.id, body);
  }

  @Get('sla-policies')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Response and resolution targets per priority',
    tags: ['maintenance'],
    params: estateParamSchema,
    response: z.array(slaPolicySchema),
  })
  slaPolicies(@CurrentEstate() estate: EstateAccess) {
    return this.maintenance.slaPolicies(estate);
  }

  @Put('sla-policies')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Set targets per priority (applies to new requests)',
    tags: ['maintenance'],
    params: estateParamSchema,
    body: putSlaPoliciesSchema,
    response: z.array(slaPolicySchema),
    errors: [403],
  })
  putSlaPolicies(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof putSlaPoliciesSchema>,
  ) {
    return this.maintenance.putSlaPolicies(estate, body);
  }

  @Post('maintenance-requests')
  @Can('maintenance.request')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Report a problem or make a complaint',
    tags: ['maintenance'],
    params: estateParamSchema,
    body: createMaintenanceRequestSchema,
    response: maintenanceRequestDetailSchema,
    status: 201,
    errors: [403, 404, 422],
  })
  submit(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createMaintenanceRequestSchema>,
  ) {
    return this.maintenance.submit(estate, body);
  }

  @Get('maintenance-requests')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Requests (management: all; residents: their household’s)',
    tags: ['maintenance'],
    params: estateParamSchema,
    query: maintenanceRequestListQuerySchema,
    response: maintenanceRequestSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof maintenanceRequestListQuerySchema>,
  ) {
    return this.maintenance.list(estate, query);
  }

  @Get('maintenance-requests/:id')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Request detail with comments',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    response: maintenanceRequestDetailSchema,
    errors: [404],
  })
  detail(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.maintenance.detail(estate, params.id);
  }

  @Post('maintenance-requests/:id/review')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Start reviewing a request',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  review(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'review', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/approve')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Approve a request',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  approve(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'approve', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/reject')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Reject a request with a reason',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestReasonSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  reject(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestReasonSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'reject', { reason: body.reason });
  }

  @Post('maintenance-requests/:id/request-info')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Ask the requester for more information',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestReasonSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  requestInfo(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestReasonSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'request_info', { reason: body.reason });
  }

  @Post('maintenance-requests/:id/respond')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Requester answers an information request',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  respond(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'respond', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/start')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Start work (staff or assignee)',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  start(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'start', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/await-materials')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Pause for materials (SLA clock pauses)',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  awaitMaterials(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'await_materials', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/resume')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Resume after materials arrive',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  resume(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'resume', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/resolve')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Mark resolved (staff or assignee)',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  resolve(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'resolve', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/reopen')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Reopen within 7 days of resolution',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestReasonSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  reopen(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestReasonSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'reopen', { reason: body.reason });
  }

  @Post('maintenance-requests/:id/close')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Confirm the fix and close',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  close(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'close', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/cancel')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Withdraw a request before work starts',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: requestTransitionSchema,
    response: maintenanceRequestDetailSchema,
    errors: [403, 404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof requestTransitionSchema>,
  ) {
    return this.maintenance.transition(estate, params.id, 'cancel', {
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Post('maintenance-requests/:id/rate')
  @Member()
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Rate the fix (closes a resolved request)',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: rateRequestSchema,
    response: maintenanceRequestDetailSchema,
    errors: [404, 409],
  })
  rate(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof rateRequestSchema>,
  ) {
    return this.maintenance.rate(estate, params.id, body.rating, body.feedback);
  }

  @Post('maintenance-requests/:id/comments')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Comment on a request (staff may add internal notes)',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: createCommentSchema,
    response: maintenanceRequestDetailSchema,
    status: 201,
    errors: [403, 404],
  })
  comment(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof createCommentSchema>,
  ) {
    return this.maintenance.comment(estate, params.id, body);
  }

  @Post('work-orders')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Create a work order (from a request or planned work)',
    tags: ['maintenance'],
    params: estateParamSchema,
    body: createWorkOrderSchema,
    response: workOrderSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  createWorkOrder(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createWorkOrderSchema>,
  ) {
    return this.maintenance.createWorkOrder(estate, body);
  }

  @Get('work-orders')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Work orders (assignees: only theirs)',
    tags: ['maintenance'],
    params: estateParamSchema,
    query: workOrderListQuerySchema,
    response: z.array(workOrderSchema),
  })
  workOrders(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof workOrderListQuerySchema>,
  ) {
    return this.maintenance.workOrders(estate, query);
  }

  @Get('work-orders/:id')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Work order detail',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    response: workOrderSchema,
    errors: [404],
  })
  workOrder(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.maintenance.workOrder(estate, params.id);
  }

  @Patch('work-orders/:id')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Assign, schedule, set costs or move status',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: updateWorkOrderSchema,
    response: workOrderSchema,
    errors: [403, 404, 409, 422],
  })
  updateWorkOrder(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof updateWorkOrderSchema>,
  ) {
    return this.maintenance.updateWorkOrder(estate, params.id, body);
  }

  @Post('work-orders/:id/materials')
  @Member()
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Record materials used',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    body: addMaterialSchema,
    response: workOrderSchema,
    status: 201,
    errors: [404, 409],
  })
  addMaterial(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof addMaterialSchema>,
  ) {
    return this.maintenance.addMaterial(estate, params.id, body);
  }

  @Post('work-orders/:id/verify')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @HttpCode(200)
  @Contract({
    summary: 'Verify completed work (and invoice a recharge)',
    tags: ['maintenance'],
    params: estateItemParamsSchema,
    response: workOrderSchema,
    errors: [403, 404, 409, 422],
  })
  verify(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.maintenance.verifyWorkOrder(estate, params.id);
  }

  @Get('recurring-maintenance')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Planned maintenance schedules',
    tags: ['maintenance'],
    params: estateParamSchema,
    response: z.array(recurringMaintenanceSchema),
  })
  recurring(@CurrentEstate() estate: EstateAccess) {
    return this.maintenance.recurring(estate);
  }

  @Post('recurring-maintenance')
  @Can('maintenance.assign')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Schedule planned maintenance',
    tags: ['maintenance'],
    params: estateParamSchema,
    body: createRecurringMaintenanceSchema,
    response: recurringMaintenanceSchema,
    status: 201,
    errors: [403, 422],
  })
  createRecurring(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createRecurringMaintenanceSchema>,
  ) {
    return this.maintenance.createRecurring(estate, body);
  }

  @Get('reports/maintenance')
  @Can('report.read')
  @RequiresFeature('maintenance')
  @Contract({
    summary: 'Volume, resolution time, SLA compliance and cost',
    tags: ['maintenance'],
    params: estateParamSchema,
    query: maintenanceReportQuerySchema,
    response: maintenanceReportSchema,
  })
  report(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof maintenanceReportQuerySchema>,
  ) {
    return this.maintenance.report(estate, query);
  }
}
