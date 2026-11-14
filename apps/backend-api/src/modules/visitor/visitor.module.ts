import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { SecurityModule } from '../security/security.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { GateService } from './gate.service';
import { PassKeysService } from './pass-keys.service';
import { PassesService } from './passes.service';
import { PublicPassController, VisitorController } from './visitor.controller';

@Module({
  imports: [TenancyModule, PropertyModule, OccupancyModule, SecurityModule, NotificationsModule],
  controllers: [PublicPassController, VisitorController],
  providers: [
    PassKeysService,
    PassesService,
    GateService,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [PassesService, GateService],
})
export class VisitorModule implements OnModuleInit {
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
        'visitors/invitations',
        (tx, estateId, take) =>
          tx.visitorInvitation.findMany({
            where: { estateId },
            orderBy: { createdAt: 'asc' },
            take,
          }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'visitors/passes',
        (tx, estateId, take) =>
          tx.visitorPass.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        ['pinLookup', 'pinWrapped', 'publicTokenHash', 'keyIndex'],
      ),
      tenantDataset(
        this.exportDb,
        'visitors/gate_events',
        (tx, estateId, take) =>
          tx.gateEvent.findMany({ where: { estateId }, orderBy: { occurredAt: 'asc' }, take }),
        ['clientUuid'],
      ),
    );
  }
}
