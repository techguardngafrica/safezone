import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  announcementListQuerySchema,
  announcementSchema,
  createAnnouncementSchema,
  estateItemParamsSchema,
  estateParamSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import {
  Can,
  CurrentEstate,
  type EstateAccess,
  Member,
  RequiresFeature,
} from '../../common/auth/auth.decorators';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { AnnouncementsService } from './announcements.service';

@Controller('v1/estates/:estateId/announcements')
export class CommunityController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Post()
  @Can('announcement.publish')
  @RequiresFeature('announcements')
  @Contract({
    summary: 'Publish an official announcement (estate, buildings or units)',
    tags: ['community'],
    params: estateParamSchema,
    body: createAnnouncementSchema,
    response: announcementSchema,
    status: 201,
    errors: [403, 404],
  })
  publish(
    @CurrentEstate() estate: EstateAccess,
    @ValidBody() body: z.infer<typeof createAnnouncementSchema>,
  ) {
    return this.announcements.publish(estate, body);
  }

  @Get()
  @Member()
  @RequiresFeature('announcements')
  @Contract({
    summary: 'Announcements for me (or all, for management)',
    tags: ['community'],
    params: estateParamSchema,
    query: announcementListQuerySchema,
    response: announcementSchema,
    paginated: true,
  })
  list(
    @CurrentEstate() estate: EstateAccess,
    @ValidQuery() query: z.infer<typeof announcementListQuerySchema>,
  ) {
    return this.announcements.list(estate, query);
  }

  @Post(':id/read')
  @Member()
  @RequiresFeature('announcements')
  @HttpCode(200)
  @Contract({
    summary: 'Mark as read',
    tags: ['community'],
    params: estateItemParamsSchema,
    response: announcementSchema,
    errors: [404],
  })
  read(
    @CurrentEstate() estate: EstateAccess,
    @ValidParams() params: z.infer<typeof estateItemParamsSchema>,
  ) {
    return this.announcements.markRead(estate, params.id);
  }
}
