import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { OnboardingModule } from '../tenancy/onboarding/onboarding.module';
import { SetupVerifiers } from '../tenancy/onboarding/setup.service';
import { AuthzModule } from '../authz/authz.module';
import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OwnershipsController } from './ownerships.controller';
import { OwnershipsService } from './ownerships.service';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';

@Module({
  imports: [TenancyModule, OnboardingModule, IdentityModule, AuthzModule],
  controllers: [PropertyController, OwnershipsController],
  providers: [PropertyService, OwnershipsService],
  exports: [PropertyService, OwnershipsService],
})
export class PropertyModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
    private readonly property: PropertyService,
    private readonly verifiers: SetupVerifiers,
  ) {}

  /** The setup wizard's `spaces` step needs at least one unit (tenancy.md §7.4). */
  onModuleInit(): void {
    this.registerExports();
    this.verifiers.register('spaces', async (estateId) =>
      (await this.property.liveUnitCount(estateId)) > 0 ? null : 'Add at least one unit first',
    );
  }

  /** Datasets for estate data exports (platform.md §6). */
  registerExports(): void {
    this.exportRegistry.register(
      tenantDataset(
        this.exportDb,
        'property/spaces',
        (tx, estateId, take) =>
          tx.space.findMany({ where: { estateId }, orderBy: { path: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'property/ownerships',
        (tx, estateId, take) =>
          tx.ownership.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'property/ownership_transfers',
        (tx, estateId, take) =>
          tx.ownershipTransfer.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
    );
  }
}
