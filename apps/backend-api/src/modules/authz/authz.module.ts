import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AccessController } from './access.controller';
import { AuthorizationGuard } from './authorization.guard';
import { AuthzService } from './authz.service';
import { StaffRolesController } from './staff-roles.controller';
import { StaffRolesService } from './staff-roles.service';

@Module({
  imports: [TenancyModule, PlatformModule],
  controllers: [AccessController, StaffRolesController],
  providers: [AuthzService, AuthorizationGuard, StaffRolesService],
  exports: [AuthzService, AuthorizationGuard, StaffRolesService],
})
export class AuthzModule {}
