import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { z } from 'zod';
import type { RelayedEvent } from '../../common/outbox/outbox-relay';
import { QueueService } from '../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../common/queues/queues';
import { createWorkerConnection } from '../../common/queues/worker-connection';
import { PaymentsService } from './payments.service';

const webhookPayloadSchema = z.object({
  provider: z.string(),
  eventId: z.string(),
  type: z.string(),
  reference: z.string().nullable(),
});

/**
 * Worker consumer of the `payments` queue: processes stored provider webhooks (verify with the provider,
 * record, allocate). Jobs are retried with backoff; processing is idempotent on the provider transaction.
 */
@Injectable()
export class PaymentsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PaymentsConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly payments: PaymentsService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<RelayedEvent>(
      QUEUES.payments,
      async (job) => {
        if (job.data.type !== 'payments.webhook.received') return;
        await this.payments.processWebhookEvent(webhookPayloadSchema.parse(job.data.payload));
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 8,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'payments job failed',
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
