import { Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';

/** Facilities and bookings (facilities.md). FacilitiesConsumer runs in the worker. */
@Module({
  imports: [BillingModule, NotificationsModule, OccupancyModule, PropertyModule, TenancyModule],
  controllers: [FacilitiesController],
  providers: [FacilitiesService],
  exports: [FacilitiesService],
})
export class FacilitiesModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.exportRegistry.register(
      tenantDataset(this.exportDb, 'facilities/facilities', (tx, estateId, take) =>
        tx.facility.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'facilities/bookings', (tx, estateId, take) =>
        tx.booking.findMany({ where: { estateId }, orderBy: { startsAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'facilities/blackouts', (tx, estateId, take) =>
        tx.facilityBlackout.findMany({ where: { estateId }, orderBy: { startsAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'facilities/damage_reports', (tx, estateId, take) =>
        tx.damageReport.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
      ),
    );
  }
}
