import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  createMoveSchema,
  decisionReasonSchema,
  estateItemParamsSchema,
  estateParamSchema,
  moveChecklistSchema,
  moveListQuerySchema,
  moveSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../../common/contract/contract';
import { MovesService } from './moves.service';

type ItemParams = z.infer<typeof estateItemParamsSchema>;

/** Move-in and move-out (occupancy.md §5). */
@Controller('v1/estates/:estateId')
export class MovesController {
  constructor(private readonly moves: MovesService) {}

  @Post('moves')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Schedule a move-in or move-out (head, owner or management)',
    tags: ['occupancy'],
    params: estateParamSchema,
    body: createMoveSchema,
    response: moveSchema,
    status: 201,
    errors: [403, 404, 409, 422],
  })
  schedule(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createMoveSchema>,
  ) {
    return this.moves.schedule(estate, body);
  }

  @Get('moves')
  @Member()
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Moves (guards: gate notices for a day; residents: theirs)',
    tags: ['occupancy'],
    params: estateParamSchema,
    query: moveListQuerySchema,
    response: z.array(moveSchema),
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof moveListQuerySchema>,
  ) {
    return this.moves.list(estate, query);
  }

  @Put('moves/:id/checklist')
  @Can('resident.approve')
  @RequiresFeature('occupancy')
  @Contract({
    summary: 'Update the move-out checklist',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: moveChecklistSchema,
    response: moveSchema,
    errors: [403, 404],
  })
  checklist(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof moveChecklistSchema>,
  ) {
    return this.moves.updateChecklist(estate, params.id, body);
  }

  @Post('moves/:id/complete')
  @Can('resident.approve')
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Complete a move now (move-out ends the occupancy)',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    response: moveSchema,
    errors: [403, 404, 409, 422],
  })
  complete(@CurrentEstate() estate: EstateAccess, @ValidParams() params: ItemParams) {
    return this.moves.complete(estate, params.id);
  }

  @Post('moves/:id/cancel')
  @Member()
  @RequiresFeature('occupancy')
  @HttpCode(200)
  @Contract({
    summary: 'Cancel a scheduled move',
    tags: ['occupancy'],
    params: estateItemParamsSchema,
    body: decisionReasonSchema,
    response: moveSchema,
    errors: [403, 404, 409],
  })
  cancel(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: ItemParams,
    @ValidBody() body: z.infer<typeof decisionReasonSchema>,
  ) {
    return this.moves.cancel(estate, params.id, body.reason);
  }
}
