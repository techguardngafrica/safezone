import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FilesModule } from '../files/files.module';
import { IdentityModule } from '../identity/identity.module';
import { AnnouncementsService } from './announcements.service';
import { ChannelsController, ModerationController, PollsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ModerationService } from './moderation.service';
import { PollsService } from './polls.service';
import { CommunityController } from './community.controller';

@Module({
  imports: [
    TenancyModule,
    PropertyModule,
    OccupancyModule,
    NotificationsModule,
    IdentityModule,
    FilesModule,
  ],
  controllers: [CommunityController, ChannelsController, ModerationController, PollsController],
  providers: [AnnouncementsService, ChannelsService, ModerationService, PollsService],
  exports: [PollsService],
})
export class CommunityModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.registerExports();
  }

  /** Datasets for estate data exports (platform.md §6). */
  registerExports(): void {
    this.exportRegistry.register(
      tenantDataset(this.exportDb, 'community/channels', (tx, estateId, take) =>
        tx.channel.findMany({
          where: { estateId, type: { not: 'direct' } },
          orderBy: { createdAt: 'asc' },
          take,
        }),
      ),
      tenantDataset(this.exportDb, 'community/moderation_actions', (tx, estateId, take) =>
        tx.moderationAction.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'community/polls', (tx, estateId, take) =>
        tx.poll.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'community/poll_options', (tx, estateId, take) =>
        tx.pollOption.findMany({ where: { estateId }, take }),
      ),
      tenantDataset(
        this.exportDb,
        'community/announcements',
        (tx, estateId, take) =>
          tx.announcement.findMany({ where: { estateId }, orderBy: { publishedAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
