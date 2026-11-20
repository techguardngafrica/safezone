import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EmergencyModule } from '../emergency/emergency.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { SecurityModule } from '../security/security.module';
import { VisitorModule } from '../visitor/visitor.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    PropertyModule,
    OccupancyModule,
    VisitorModule,
    SecurityModule,
    EmergencyModule,
    BillingModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
