import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { UtilitiesController } from './utilities.controller';
import { UtilitiesService } from './utilities.service';

/** Utilities (utilities.md). Billing reads metered consumption through UtilitiesService. */
@Module({
  imports: [TenancyModule, PropertyModule, OccupancyModule, NotificationsModule],
  controllers: [UtilitiesController],
  providers: [UtilitiesService],
  exports: [UtilitiesService],
})
export class UtilitiesModule implements OnModuleInit {
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
        'utilities/meters',
        (tx, estateId, take) =>
          tx.meter.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'utilities/meter_readings',
        (tx, estateId, take) =>
          tx.meterReading.findMany({ where: { estateId }, orderBy: { readAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'utilities/outages',
        (tx, estateId, take) =>
          tx.utilityOutage.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
