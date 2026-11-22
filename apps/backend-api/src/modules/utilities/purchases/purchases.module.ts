import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { OccupancyModule } from '../../occupancy/occupancy.module';
import { PaymentsModule } from '../../payments/payments.module';
import { PropertyModule } from '../../property/property.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { TopupsController } from '../topups/topups.controller';
import { TopupsService } from '../topups/topups.service';

/**
 * Prepaid token purchases (ADR-0018) and airtime and data (ADR-0025). A separate Nest module inside utilities because it needs payments,
 * which depends on billing, which depends on utilities. It owns `utility_purchases` and
 * `utility_purchase_events`.
 */
@Module({
  imports: [PaymentsModule, OccupancyModule, PropertyModule, NotificationsModule, TenancyModule],
  controllers: [PurchasesController, TopupsController],
  providers: [PurchasesService, TopupsService],
  exports: [PurchasesService, TopupsService],
})
export class UtilityPurchasesModule {}
