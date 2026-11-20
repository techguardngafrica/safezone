import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { OccupancyModule } from '../../occupancy/occupancy.module';
import { PaymentsModule } from '../../payments/payments.module';
import { PropertyModule } from '../../property/property.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

/**
 * Prepaid token purchases (ADR-0018). A separate Nest module inside utilities because it needs payments,
 * which depends on billing, which depends on utilities. It owns `utility_purchases` and
 * `utility_purchase_events`.
 */
@Module({
  imports: [PaymentsModule, OccupancyModule, PropertyModule, NotificationsModule, TenancyModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class UtilityPurchasesModule {}
