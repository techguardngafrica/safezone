import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/** Estate data exports. Datasets come from each module through EstateExportRegistry. */
@Module({
  imports: [NotificationsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
