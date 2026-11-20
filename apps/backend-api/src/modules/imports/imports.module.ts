import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { BillingModule } from '../billing/billing.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ImportRunner } from './import-runner.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * Bulk import framework (tenancy.md §7.8). The API validates and queues; the worker's ImportsConsumer
 * runs ImportRunner, which applies rows through the owning modules' services.
 */
@Module({
  imports: [AuthzModule, TenancyModule, PropertyModule, OccupancyModule, BillingModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportRunner],
  exports: [ImportsService, ImportRunner],
})
export class ImportsModule {}
