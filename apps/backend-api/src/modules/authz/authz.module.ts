import { Module } from '@nestjs/common';
import { VendorAccessModule } from '../marketplace/access/vendor-access.service';
import { PlatformModule } from '../platform/platform.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AccessController } from './access.controller';
import { AuthorizationGuard } from './authorization.guard';
import { AuthzService } from './authz.service';
import { PlatformStaffService } from './platform-staff.service';
import { StaffRolesController } from './staff-roles.controller';
import { StaffRolesService } from './staff-roles.service';

@Module({
  imports: [TenancyModule, PlatformModule, VendorAccessModule],
  controllers: [AccessController, StaffRolesController],
  providers: [AuthzService, AuthorizationGuard, StaffRolesService, PlatformStaffService],
  exports: [AuthzService, AuthorizationGuard, StaffRolesService, PlatformStaffService],
})
export class AuthzModule {}
