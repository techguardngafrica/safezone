import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { z } from 'zod';
import type { RelayedEvent } from '../../../common/outbox/outbox-relay';
import { QueueService } from '../../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../../common/queues/queues';
import { createWorkerConnection } from '../../../common/queues/worker-connection';
import { ExportsService } from './exports.service';

const payload = z.object({ exportId: z.uuid() });

/** `exports` queue: builds requested estate exports one at a time (they are large). */
@Injectable()
export class ExportsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ExportsConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly exports: ExportsService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<RelayedEvent>(
      QUEUES.exports,
      async (job) => {
        if (job.data.type !== 'platform.export.requested' || !job.data.estateId) return;
        await this.exports.build(job.data.estateId, payload.parse(job.data.payload).exportId);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'export job failed',
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
