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
import { FilesService } from './files.service';

/** Worker-process consumer of the `files` queue: scans uploaded files. */
@Injectable()
export class FilesConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('FilesConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly files: FilesService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<RelayedEvent>(
      QUEUES.files,
      async (job) => {
        const fileId = (job.data.payload as { fileId?: unknown }).fileId;
        if (typeof fileId === 'string') await this.files.scan(fileId);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'file job failed',
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
