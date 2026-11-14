import { Module } from '@nestjs/common';
import { EstateController } from './estate.controller';
import { TenancyService } from './tenancy.service';

@Module({
  controllers: [EstateController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
