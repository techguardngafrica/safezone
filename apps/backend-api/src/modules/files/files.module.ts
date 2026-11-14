import { Module } from '@nestjs/common';
import { EstateFilesController, MyFilesController } from './files.controller';
import { FilesService } from './files.service';

/** API side of the file service. The worker adds FilesConsumer (worker.module.ts). */
@Module({
  controllers: [EstateFilesController, MyFilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
