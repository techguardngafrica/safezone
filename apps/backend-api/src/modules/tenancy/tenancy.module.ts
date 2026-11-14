import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { EstateController } from './estate.controller';
import { TenancyService } from './tenancy.service';

@Module({
  controllers: [EstateController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule implements OnModuleInit {
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
        'estate/settings',
        (tx, estateId, take) => tx.estateSetting.findMany({ where: { estateId }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'estate/memberships',
        (tx, estateId, take) =>
          tx.estateMembership.findMany({ where: { estateId }, orderBy: { joinedAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
