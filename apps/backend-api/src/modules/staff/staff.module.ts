import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * Staff management (ADR-0021): composes identity, tenancy and authz, so it sits above all three.
 * IdentityModule already imports AuthzModule, which is why this cannot live inside authz.
 */
@Module({
  imports: [AuthzModule, IdentityModule, TenancyModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
