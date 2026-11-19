import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  createGateSchema,
  createIncidentSchema,
  estateItemParamsSchema,
  estateParamSchema,
  gateSchema,
  incidentDetailSchema,
  incidentEvidenceInputSchema,
  incidentListQuerySchema,
  incidentNoteInputSchema,
  incidentSchema,
  incidentTransitionSchema,
  updateGateSchema,
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
import { GatesService } from './gates.service';
import { IncidentsService } from './incidents.service';

@Controller('v1/estates/:estateId/gates')
export class SecurityController {
  constructor(private readonly gates: GatesService) {}

  @Get()
  @Member()
  @RequiresFeature('security')
  @Contract({
    summary: 'Gates',
    tags: ['security'],
    params: estateParamSchema,
    response: z.array(gateSchema),
  })
  list(@CurrentEstate() estate: EstateAccess) {
    return this.gates.list(estate);
  }

  @Post()
  @Can('security.staff.manage')
  @RequiresFeature('security')
  @Contract({
    summary: 'Add a gate',
    tags: ['security'],
    params: estateParamSchema,
    body: createGateSchema,
    response: gateSchema,
    status: 201,
    errors: [403, 409],
  })
  create(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createGateSchema>,
  ) {
    return this.gates.create(estate, body);
  }

  @Patch(':id')
  @Can('security.staff.manage')
  @RequiresFeature('security')
  @Contract({
    summary: 'Rename, retype or close a gate',
    tags: ['security'],
    params: estateItemParamsSchema,
    body: updateGateSchema,
    response: gateSchema,
    errors: [403, 404, 409],
  })
  update(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof updateGateSchema>,
  ) {
    return this.gates.update(estate, params.id, body);
  }
}

@Controller('v1/estates/:estateId/incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  @Can('incident.report', 'incident.manage')
  @RequiresFeature('security')
  @Contract({
    summary: 'Report an incident (guards, residents, managers)',
    tags: ['security'],
    params: estateParamSchema,
    body: createIncidentSchema,
    response: incidentDetailSchema,
    status: 201,
    errors: [404, 422],
  })
  report(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createIncidentSchema>,
  ) {
    return this.incidents.report(estate, body);
  }

  @Get()
  @Can('incident.report', 'incident.manage')
  @RequiresFeature('security')
  @Contract({
    summary: 'Incidents (managers: all; others: reported by or assigned to me)',
    tags: ['security'],
    params: estateParamSchema,
    query: incidentListQuerySchema,
    response: incidentSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof incidentListQuerySchema>,
  ) {
    return this.incidents.list(estate, query);
  }

  @Get(':id')
  @Can('incident.report', 'incident.manage')
  @RequiresFeature('security')
  @Contract({
    summary: 'Incident with evidence and timeline',
    tags: ['security'],
    params: estateItemParamsSchema,
    response: incidentDetailSchema,
    errors: [404],
  })
  detail(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.incidents.detail(estate, params.id);
  }

  @Post(':id/notes')
  @Can('incident.report', 'incident.manage')
  @RequiresFeature('security')
  @HttpCode(200)
  @Contract({
    summary: 'Add a note (append-only)',
    tags: ['security'],
    params: estateItemParamsSchema,
    body: incidentNoteInputSchema,
    response: incidentDetailSchema,
    errors: [404, 409],
  })
  note(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof incidentNoteInputSchema>,
  ) {
    return this.incidents.addNote(estate, params.id, body.body);
  }

  @Post(':id/evidence')
  @Can('incident.report', 'incident.manage')
  @RequiresFeature('security')
  @HttpCode(200)
  @Contract({
    summary: 'Attach uploaded photos or videos (hash recorded for chain of custody)',
    tags: ['security'],
    params: estateItemParamsSchema,
    body: incidentEvidenceInputSchema,
    response: incidentDetailSchema,
    errors: [404, 409, 422],
  })
  evidence(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof incidentEvidenceInputSchema>,
  ) {
    return this.incidents.addEvidence(estate, params.id, body.fileIds);
  }

  @Post(':id/transition')
  @Can('incident.manage')
  @RequiresFeature('security')
  @HttpCode(200)
  @Contract({
    summary: 'Review, assign, resolve, reopen or close (send the version you saw)',
    tags: ['security'],
    params: estateItemParamsSchema,
    body: incidentTransitionSchema,
    response: incidentDetailSchema,
    errors: [404, 409, 422],
  })
  transition(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
    @ValidBody() body: z.infer<typeof incidentTransitionSchema>,
  ) {
    return this.incidents.transition(estate, params.id, body);
  }
}
