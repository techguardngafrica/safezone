import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PropertyModule } from '../property/property.module';
import { OnboardingModule } from '../tenancy/onboarding/onboarding.module';
import { IncidentsService } from './incidents.service';
import { SetupVerifiers } from '../tenancy/onboarding/setup.service';
import { GatesService } from './gates.service';
import { RateLimiter, RedisRateLimiter } from '../../common/rate-limit/rate-limiter';
import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { GateAccessService } from './gate-access.service';
import {
  GateAuthController,
  GateDevicesController,
  IncidentsController,
  SecurityController,
  ShiftsController,
} from './security.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [
    AuthzModule,
    FilesModule,
    IdentityModule,
    NotificationsModule,
    OnboardingModule,
    PropertyModule,
    TenancyModule,
  ],
  controllers: [
    SecurityController,
    IncidentsController,
    ShiftsController,
    GateDevicesController,
    GateAuthController,
  ],
  providers: [
    GatesService,
    IncidentsService,
    ShiftsService,
    GateAccessService,
    { provide: RateLimiter, useClass: RedisRateLimiter },
  ],
  exports: [GatesService, GateAccessService, IncidentsService, ShiftsService],
})
export class SecurityModule implements OnModuleInit {
  constructor(
    private readonly gates: GatesService,
    private readonly verifiers: SetupVerifiers,
  ) {}

  /** The setup wizard's `gates` step needs at least one active gate (tenancy.md §7.4). */
  onModuleInit(): void {
    this.verifiers.register('gates', async (estateId) =>
      (await this.gates.activeCount(estateId)) > 0 ? null : 'Add at least one gate first',
    );
  }
}
