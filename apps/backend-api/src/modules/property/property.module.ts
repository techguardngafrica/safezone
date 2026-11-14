import { Module, type OnModuleInit } from '@nestjs/common';
import { OnboardingModule } from '../tenancy/onboarding/onboarding.module';
import { SetupVerifiers } from '../tenancy/onboarding/setup.service';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';

@Module({
  imports: [TenancyModule, OnboardingModule],
  controllers: [PropertyController],
  providers: [PropertyService],
  exports: [PropertyService],
})
export class PropertyModule implements OnModuleInit {
  constructor(
    private readonly property: PropertyService,
    private readonly verifiers: SetupVerifiers,
  ) {}

  /** The setup wizard's `spaces` step needs at least one unit (tenancy.md §7.4). */
  onModuleInit(): void {
    this.verifiers.register('spaces', async (estateId) =>
      (await this.property.liveUnitCount(estateId)) > 0 ? null : 'Add at least one unit first',
    );
  }
}
