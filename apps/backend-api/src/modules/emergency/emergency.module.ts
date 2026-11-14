import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { EmergencyController } from './emergency.controller';
import { SosService } from './sos.service';

@Module({
  imports: [TenancyModule, AuthzModule, OccupancyModule, PropertyModule, NotificationsModule],
  controllers: [EmergencyController],
  providers: [SosService],
  exports: [SosService],
})
export class EmergencyModule implements OnModuleInit {
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
        'emergency/sos_alerts',
        (tx, estateId, take) =>
          tx.sosAlert.findMany({ where: { estateId }, orderBy: { triggeredAt: 'asc' }, take }),
        ['clientUuid'],
      ),
      tenantDataset(
        this.exportDb,
        'emergency/sos_events',
        (tx, estateId, take) =>
          tx.sosEvent.findMany({ where: { estateId }, orderBy: { occurredAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'emergency/broadcasts',
        (tx, estateId, take) =>
          tx.emergencyBroadcast.findMany({ where: { estateId }, orderBy: { sentAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
