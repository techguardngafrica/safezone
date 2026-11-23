import { Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { BillingModule } from '../billing/billing.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({
  imports: [BillingModule],
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.exportRegistry.register(
      tenantDataset(
        this.exportDb,
        'accounting/coa_accounts',
        (tx, estateId, take) =>
          tx.coaAccount.findMany({ where: { estateId }, orderBy: { code: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'accounting/financial_periods',
        (tx, estateId, take) =>
          tx.financialPeriod.findMany({ where: { estateId }, orderBy: { startsOn: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'accounting/expenses',
        (tx, estateId, take) =>
          tx.expense.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
      tenantDataset(
        this.exportDb,
        'accounting/payables',
        (tx, estateId, take) =>
          tx.payable.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
        [],
      ),
    );
  }
}
