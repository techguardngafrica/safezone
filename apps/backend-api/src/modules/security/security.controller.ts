import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  createGateSchema,
  estateItemParamsSchema,
  estateParamSchema,
  gateSchema,
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
import { Contract, ValidBody, ValidParams } from '../../common/contract/contract';
import { GatesService } from './gates.service';

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
