import { Module, type OnModuleInit } from '@nestjs/common';
import { OnboardingModule } from '../tenancy/onboarding/onboarding.module';
import { SetupVerifiers } from '../tenancy/onboarding/setup.service';
import { GatesService } from './gates.service';
import { SecurityController } from './security.controller';

@Module({
  imports: [OnboardingModule],
  controllers: [SecurityController],
  providers: [GatesService],
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
