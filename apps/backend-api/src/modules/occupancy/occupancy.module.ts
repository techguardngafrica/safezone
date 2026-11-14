import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { AuthzModule } from '../authz/authz.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { JoinRequestsService } from './join-requests.service';
import { EstateOccupancyController, MyOccupancyController } from './occupancy.controller';
import { OccupancyService } from './occupancy.service';

@Module({
  imports: [TenancyModule, AuthzModule, IdentityModule, NotificationsModule, PropertyModule],
  controllers: [MyOccupancyController, EstateOccupancyController],
  providers: [
    OccupancyService,
    JoinRequestsService,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [OccupancyService],
})
export class OccupancyModule implements OnModuleInit {
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
        'occupancy/households',
        (tx, estateId, take) =>
          tx.household.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'occupancy/household_members',
        (tx, estateId, take) =>
          tx.householdMember.findMany({ where: { estateId }, orderBy: { joinedAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'occupancy/occupancies',
        (tx, estateId, take) =>
          tx.occupancy.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'occupancy/vehicles',
        (tx, estateId, take) =>
          tx.vehicle.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'occupancy/domestic_staff',
        (tx, estateId, take) =>
          tx.domesticStaff.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'occupancy/join_requests',
        (tx, estateId, take) =>
          tx.joinRequest.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
