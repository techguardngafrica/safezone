import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { AuthzModule } from '../authz/authz.module';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { VisitorModule } from '../visitor/visitor.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

/** Maintenance (maintenance.md). MaintenanceConsumer runs in the worker process. */
@Module({
  imports: [
    AuthzModule,
    BillingModule,
    FilesModule,
    NotificationsModule,
    OccupancyModule,
    PropertyModule,
    VisitorModule,
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule implements OnModuleInit {
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
        'maintenance/categories',
        (tx, estateId, take) =>
          tx.maintenanceCategory.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'maintenance/requests',
        (tx, estateId, take) =>
          tx.maintenanceRequest.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'maintenance/comments',
        (tx, estateId, take) =>
          tx.maintenanceComment.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'maintenance/work_orders',
        (tx, estateId, take) =>
          tx.workOrder.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'maintenance/materials',
        (tx, estateId, take) =>
          tx.workOrderMaterial.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'maintenance/recurring',
        (tx, estateId, take) =>
          tx.recurringMaintenance.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
    );
  }
}
