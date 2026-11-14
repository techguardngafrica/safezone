import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../../common/export/export-registry';
import { tenantDataset } from '../../../common/export/tenant-dataset';
import { DatabaseService } from '../../../common/database/database.service';
import { AuthzModule } from '../../authz/authz.module';
import { BillingModule } from '../../billing/billing.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PropertyModule } from '../../property/property.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { OccupancyModule } from '../occupancy.module';
import { MovesController } from './moves.controller';
import { MovesService } from './moves.service';

/**
 * Occupancy's move workflows, a separate Nest module because they read balances from billing, which itself
 * depends on occupancy. It owns `move_events`.
 */
@Module({
  imports: [
    OccupancyModule,
    BillingModule,
    PropertyModule,
    TenancyModule,
    AuthzModule,
    NotificationsModule,
  ],
  controllers: [MovesController],
  providers: [MovesService],
  exports: [MovesService],
})
export class MovesModule implements OnModuleInit {
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
      tenantDataset(
        this.exportDb,
        'occupancy/moves',
        (tx, estateId, take) =>
          tx.moveEvent.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
