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
import { OrdersService } from './orders.service';

const chargeEvent = z.object({ reference: z.string().min(1), amountKobo: z.number().int() });
const refundEvent = z.object({ orderId: z.uuid(), targetKobo: z.number().int().positive() });

/**
 * `marketplace` queue (ADR-0023): verified order payments and refunds. Both steps are idempotent, so
 * BullMQ retries are safe; a provider outage only delays a refund.
 */
@Injectable()
export class MarketplaceConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MarketplaceConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly orders: OrdersService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker(
      QUEUES.marketplace,
      async (job) => {
        const event = job.data as RelayedEvent;
        if (!event.estateId) return;
        if (event.type === 'payments.marketplace_charge.succeeded') {
          const charge = chargeEvent.parse(event.payload);
          await this.orders.handlePaid(event.estateId, charge.reference, charge.amountKobo);
        } else if (event.type === 'marketplace.order.refund_requested') {
          const refund = refundEvent.parse(event.payload);
          await this.orders.processRefund(event.estateId, refund.orderId, refund.targetKobo);
        }
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'marketplace job failed',
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
