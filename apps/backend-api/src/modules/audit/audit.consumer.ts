import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import type { RelayedEvent } from '../../common/outbox/outbox-relay';
import { QueueService } from '../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../common/queues/queues';
import { createWorkerConnection } from '../../common/queues/worker-connection';
import { AuditService } from './audit.service';

/** Worker-process consumer of the `audit` queue. Concurrency 1 per instance; chains are locked per stream. */
@Injectable()
export class AuditConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AuditConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly audit: AuditService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<RelayedEvent>(
      QUEUES.audit,
      async (job) => {
        await this.audit.record(job.data);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'audit job failed',
        eventId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
