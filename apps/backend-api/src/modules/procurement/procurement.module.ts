import { Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { AccountingModule } from '../accounting/accounting.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';

@Module({
  imports: [AccountingModule, MaintenanceModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.exportRegistry.register(
      tenantDataset(
        this.exportDb,
        'procurement/suppliers',
        (tx, estateId, take) =>
          tx.supplier.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'procurement/purchase_orders',
        (tx, estateId, take) =>
          tx.purchaseOrder.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'procurement/assets',
        (tx, estateId, take) =>
          tx.asset.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
