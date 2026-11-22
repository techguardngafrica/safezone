import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ClassifiedsController } from './classifieds.controller';
import { ClassifiedsService } from './classifieds.service';
import { MarketplaceController } from './marketplace.controller';
import { OrdersService } from './orders.service';
import { PlatformMarketplaceController } from './platform-marketplace.controller';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

/**
 * Marketplace, vendors and estate classifieds (marketplace.md, ADR-0023). MarketplaceConsumer runs in
 * the worker; VendorAccessModule (access/) is used by the authorization guard.
 */
@Module({
  imports: [IdentityModule, NotificationsModule, OccupancyModule, PaymentsModule, TenancyModule],
  controllers: [
    VendorsController,
    MarketplaceController,
    ClassifiedsController,
    PlatformMarketplaceController,
  ],
  providers: [VendorsService, OrdersService, ClassifiedsService],
  exports: [VendorsService, OrdersService, ClassifiedsService],
})
export class MarketplaceModule {}
