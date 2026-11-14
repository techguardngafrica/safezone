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
import { DeliveryService, requestFromEvent } from './delivery.service';

export const PUSH_RECEIPTS_JOB = 'push-receipts';

/** Worker-process consumer of the `notifications` queue, plus the per-minute Expo receipts check. */
@Injectable()
export class NotificationsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('NotificationsConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly delivery: DeliveryService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker(
      QUEUES.notifications,
      async (job) => {
        if (job.name === PUSH_RECEIPTS_JOB) {
          await this.delivery.checkPushReceipts();
          return;
        }
        const request = requestFromEvent(job.data as RelayedEvent);
        if (request) await this.delivery.deliver(request);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 10,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'notification job failed',
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      }),
    );
    await this.queues
      .queue(QUEUES.notifications)
      .upsertJobScheduler(
        PUSH_RECEIPTS_JOB,
        { every: 60_000 },
        { name: PUSH_RECEIPTS_JOB, opts: { attempts: 1 } },
      );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
