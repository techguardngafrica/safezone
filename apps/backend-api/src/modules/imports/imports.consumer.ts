import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { z } from 'zod';
import { QueueService } from '../../common/queues/queue.service';
import { DEFAULT_JOB_OPTIONS, QUEUE_PREFIX, QUEUES } from '../../common/queues/queues';
import { createWorkerConnection } from '../../common/queues/worker-connection';
import { ImportRunner } from './import-runner.service';

const confirmedEventSchema = z.object({
  type: z.literal('imports.job.confirmed'),
  estateId: z.uuid(),
  payload: z.object({ jobId: z.uuid() }),
});

/** Worker consumer of the `imports` queue: runs each confirmed import job (one at a time per worker). */
@Injectable()
export class ImportsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ImportsConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly runner: ImportRunner,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker(
      QUEUES.imports,
      async (job) => {
        const event = confirmedEventSchema.safeParse(job.data);
        if (!event.success) return;
        await this.runner.run(event.data.estateId, event.data.payload.jobId);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.warn({
        msg: 'import job failed',
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      });
      const maxAttempts = job?.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 1;
      const event = confirmedEventSchema.safeParse(job?.data);
      if (job && event.success && job.attemptsMade >= maxAttempts) {
        void this.runner
          .markFailed(event.data.estateId, event.data.payload.jobId)
          .catch((markError: unknown) =>
            this.logger.error({
              msg: 'could not mark import failed',
              jobId: job.id,
              error: markError instanceof Error ? markError.name : 'unknown',
            }),
          );
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
