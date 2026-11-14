import { Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { EstateExportRegistry } from '../../common/export/export-registry';
import { tenantDataset } from '../../common/export/tenant-dataset';
import { AuthzModule } from '../authz/authz.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/** Estate document management (documents.md). Expiry reminders run from the occupancy daily job. */
@Module({
  imports: [AuthzModule, FilesModule, NotificationsModule, OccupancyModule, PropertyModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule implements OnModuleInit {
  constructor(
    private readonly exportRegistry: EstateExportRegistry,
    private readonly exportDb: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.exportRegistry.register(
      tenantDataset(this.exportDb, 'documents/folders', (tx, estateId, take) =>
        tx.documentFolder.findMany({ where: { estateId }, take }),
      ),
      tenantDataset(this.exportDb, 'documents/documents', (tx, estateId, take) =>
        tx.document.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'documents/versions', (tx, estateId, take) =>
        tx.documentVersion.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' }, take }),
      ),
      tenantDataset(this.exportDb, 'documents/access_log', (tx, estateId, take) =>
        tx.documentAccess.findMany({ where: { estateId }, orderBy: { at: 'asc' }, take }),
      ),
    );
  }
}
