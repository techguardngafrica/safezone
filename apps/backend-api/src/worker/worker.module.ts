import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';

/** Root module for the worker process. Queue processors from each domain module are imported here. */
@Module({
  imports: [ConfigModule],
})
export class WorkerModule {}
