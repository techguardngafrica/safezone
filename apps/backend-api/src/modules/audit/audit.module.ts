import { Module, type OnModuleInit } from '@nestjs/common';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { DatabaseService } from '../../common/database/database.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** API side: estate audit log. The worker adds AuditConsumer (see worker.module.ts). */
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule implements OnModuleInit {
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
        'audit/events',
        (tx, estateId, take) =>
          tx.auditEvent.findMany({ where: { estateId }, orderBy: { seq: 'asc' }, take }),
        ['ip', 'userAgent'],
      ),
    );
  }
}
