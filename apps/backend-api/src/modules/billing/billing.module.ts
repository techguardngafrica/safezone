import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { UtilitiesModule } from '../utilities/utilities.module';
import { BillingController } from './billing.controller';
import { BillingJobsService } from './billing-jobs.service';
import { BillingRunsService } from './billing-runs.service';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger.service';

/** Billing (billing.md): charges, runs, invoices, credit notes, waivers, allocations and the ledger. */
@Module({
  imports: [TenancyModule, NotificationsModule, PropertyModule, OccupancyModule, UtilitiesModule],
  controllers: [BillingController],
  providers: [LedgerService, InvoicesService, BillingRunsService, BillingJobsService],
  exports: [InvoicesService, LedgerService, BillingJobsService],
})
export class BillingModule implements OnModuleInit {
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
        'billing/charges',
        (tx, estateId, take) =>
          tx.charge.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/billing_runs',
        (tx, estateId, take) =>
          tx.billingRun.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/invoices',
        (tx, estateId, take) =>
          tx.invoice.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/invoice_lines',
        (tx, estateId, take) =>
          tx.invoiceLine.findMany({
            where: { estateId },
            orderBy: [{ invoiceId: 'asc' }, { position: 'asc' }],
            take,
          }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/credit_notes',
        (tx, estateId, take) =>
          tx.creditNote.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/waivers',
        (tx, estateId, take) =>
          tx.waiver.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/allocations',
        (tx, estateId, take) =>
          tx.allocation.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/ledger_accounts',
        (tx, estateId, take) =>
          tx.ledgerAccount.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/journals',
        (tx, estateId, take) =>
          tx.journal.findMany({ where: { estateId }, orderBy: { postedAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'billing/ledger_entries',
        (tx, estateId, take) =>
          tx.ledgerEntry.findMany({ where: { estateId }, orderBy: { occurredAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
