import { Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import {
  assignSosSchema,
  closeSosSchema,
  emergencyBroadcastResultSchema,
  emergencyBroadcastSchema,
  escalateSosSchema,
  estateItemParamsSchema,
  estateParamSchema,
  resolveSosSchema,
  sosAlertSchema,
  sosDetailSchema,
  sosListQuerySchema,
  sosLocationInputSchema,
  sosNoteSchema,
  triggerSosSchema,
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
import { DomainError } from '../../common/errors/domain-error';
import { SosService } from './sos.service';

const idempotencyKeySchema = z.uuid();

/** SOS (emergency.md §9). These screens never show advertising. */
@Controller('v1/estates/:estateId')
export class EmergencyController {
  constructor(private readonly sos: SosService) {}

  @Post('sos')
  @Can('sos.trigger')
  @RequiresFeature('emergency')
  @Contract({
    summary: 'Raise an SOS (Idempotency-Key: a UUID per press)',
    tags: ['emergency'],
    params: estateParamSchema,
    body: triggerSosSchema,
    response: sosAlertSchema,
    status: 201,
    errors: [403, 404],
  })
  trigger(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof triggerSosSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send an Idempotency-Key header (a UUID)',
        400,
      );
    }
    return this.sos.trigger(estate, parsed.data, body);
  }

  @Get('sos')
  @Member()
  @RequiresFeature('emergency')
  @Contract({
    summary: 'Alerts (responders: the estate; residents: their own)',
    tags: ['emergency'],
    params: estateParamSchema,
    query: sosListQuerySchema,
    response: z.array(sosAlertSchema),
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof sosListQuerySchema>,
  ) {
    return this.sos.list(estate, query);
  }

  @Get('sos/:id')
  @Member()
  @RequiresFeature('emergency')
  @Contract({
    summary: 'Alert with its timeline',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    response: sosDetailSchema,
    errors: [404],
  })
  detail(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.sos.detail(estate, params.id);
  }

  @Post('sos/:id/location')
  @Can('sos.trigger')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Location update while the alert is active',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    body: sosLocationInputSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  location(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof sosLocationInputSchema>,
  ) {
    return this.sos.location(estate, params.id, body);
  }

  @Post('sos/:id/cancel')
  @Can('sos.trigger')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Cancel before anyone acknowledges',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.sos.act(estate, params.id, 'cancel');
  }

  @Post('sos/:id/acknowledge')
  @Can('sos.respond')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Acknowledge (stops escalation)',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  acknowledge(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.sos.act(estate, params.id, 'acknowledge');
  }

  @Post('sos/:id/assign')
  @Can('sos.respond')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Assign a responder',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    body: assignSosSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409, 422],
  })
  assign(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof assignSosSchema>,
  ) {
    return this.sos.act(estate, params.id, 'assign', { assignee: body.userId });
  }

  @Post('sos/:id/responding')
  @Can('sos.respond')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'On the way',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  responding(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.sos.act(estate, params.id, 'responding');
  }

  @Post('sos/:id/escalate')
  @Can('sos.respond')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Manually escalate an active alert to supervisors and managers',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    body: escalateSosSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  escalate(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof escalateSosSchema>,
  ) {
    return this.sos.escalate(estate, params.id, body.note);
  }

  @Post('sos/:id/notes')
  @Member()
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Add a timeline note',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    body: sosNoteSchema,
    response: sosAlertSchema,
    errors: [404],
  })
  note(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof sosNoteSchema>,
  ) {
    return this.sos.note(estate, params.id, body.note);
  }

  @Post('sos/:id/resolve')
  @Can('sos.respond')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Resolve (or mark a false alarm)',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    body: resolveSosSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  resolve(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof resolveSosSchema>,
  ) {
    return this.sos.act(estate, params.id, 'resolve', {
      resolution: body.resolution,
      falseAlarm: body.falseAlarm,
    });
  }

  @Post('sos/:id/close')
  @Can('sos.respond')
  @RequiresFeature('emergency')
  @HttpCode(200)
  @Contract({
    summary: 'Close the record (supervisor or manager)',
    tags: ['emergency'],
    params: estateItemParamsSchema,
    body: closeSosSchema,
    response: sosAlertSchema,
    errors: [403, 404, 409],
  })
  close(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof closeSosSchema>,
  ) {
    return this.sos.act(estate, params.id, 'close', {
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.category ? { category: body.category } : {}),
    });
  }

  @Post('emergency-broadcasts')
  @Can('broadcast.emergency')
  @RequiresFeature('emergency')
  @Contract({
    summary: 'Emergency broadcast to every member (push and SMS)',
    tags: ['emergency'],
    params: estateParamSchema,
    body: emergencyBroadcastSchema,
    response: emergencyBroadcastResultSchema,
    status: 201,
    errors: [403],
  })
  broadcast(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof emergencyBroadcastSchema>,
  ) {
    return this.sos.broadcast(estate, body.title, body.body);
  }
}
