import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PropertyModule } from '../property/property.module';
import { OnboardingModule } from '../tenancy/onboarding/onboarding.module';
import { IncidentsService } from './incidents.service';
import { SetupVerifiers } from '../tenancy/onboarding/setup.service';
import { GatesService } from './gates.service';
import { IncidentsController, SecurityController, ShiftsController } from './security.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [AuthzModule, FilesModule, NotificationsModule, OnboardingModule, PropertyModule],
  controllers: [SecurityController, IncidentsController, ShiftsController],
  providers: [GatesService, IncidentsService, ShiftsService],
  exports: [GatesService],
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
