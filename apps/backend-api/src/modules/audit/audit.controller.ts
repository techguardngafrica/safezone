import { Controller, Get } from '@nestjs/common';
import { estateParamSchema, paginationQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import { Can, CurrentEstate, type EstateAccess } from '../../common/auth/auth.decorators';
import { Contract, ValidQuery } from '../../common/contract/contract';
import { AuditService } from './audit.service';

const auditEventSchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  actingRole: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  reason: z.string().nullable(),
  app: z.string().nullable(),
});

@Controller('v1/estates/:estateId/audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Can('audit.read')
  @Contract({
    summary: 'Estate audit log (newest first)',
    tags: ['audit'],
    params: estateParamSchema,
    query: paginationQuerySchema,
    response: auditEventSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof paginationQuerySchema>,
  ) {
    return this.audit.listForEstate(estate, query.limit, query.cursor);
  }
}
