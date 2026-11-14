import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/** Shared database access for every module (ADR-0001). Imported once by each process root module. */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
