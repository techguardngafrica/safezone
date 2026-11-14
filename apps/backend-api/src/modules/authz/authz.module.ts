import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AccessController } from './access.controller';
import { AuthorizationGuard } from './authorization.guard';
import { AuthzService } from './authz.service';

@Module({
  imports: [TenancyModule],
  controllers: [AccessController],
  providers: [AuthzService, AuthorizationGuard],
  exports: [AuthzService, AuthorizationGuard],
})
export class AuthzModule {}
