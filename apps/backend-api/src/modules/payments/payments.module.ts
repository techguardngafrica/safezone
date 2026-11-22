import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { BillingModule } from '../billing/billing.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PaymentsController, PaymentsPublicController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PlatformTransactionsController } from './platform-transactions.controller';

/** Payments (payments.md). PaymentsConsumer runs in the worker process (worker.module.ts). */
import { TransfersService } from './transfers.service';
import { WalletController } from './wallet.controller';
import { WalletStore } from './wallet-store.service';

@Module({
  imports: [
    TenancyModule,
    BillingModule,
    IdentityModule,
    NotificationsModule,
    OccupancyModule,
    PropertyModule,
  ],
  controllers: [
    PaymentsPublicController,
    PaymentsController,
    PlatformTransactionsController,
    WalletController,
  ],
  providers: [PaymentsService, WalletStore, TransfersService],
  exports: [PaymentsService, WalletStore, TransfersService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.registerExports();
  }

  /** Datasets for estate data exports (platform.md §6). */
  registerExports(): void {
    this.exportRegistry.register(
      tenantDataset(
        this.exportDb,
        'payments/transactions',
        (tx, estateId, take) =>
          tx.paymentTransaction.findMany({ where: { estateId }, orderBy: { paidAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'payments/intents',
        (tx, estateId, take) =>
          tx.paymentIntent.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        ['authorizationUrl', 'subaccountCode', 'idempotencyKey'],
      ),
      tenantDataset(
        this.exportDb,
        'payments/manual_payments',
        (tx, estateId, take) =>
          tx.manualPayment.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'payments/refunds',
        (tx, estateId, take) =>
          tx.refund.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'payments/payout_accounts',
        (tx, estateId, take) =>
          tx.payoutAccount.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        ['subaccountCode'],
      ),
      tenantDataset(
        this.exportDb,
        'payments/virtual_accounts',
        (tx, estateId, take) =>
          tx.virtualAccount.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        ['customerCode'],
      ),
    );
  }
}
