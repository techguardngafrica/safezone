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
import { TenancyService } from '../../tenancy/tenancy.service';
import { PurchasesService } from './purchases.service';

const chargeEvent = z.object({
  reference: z.string().min(1),
  amountKobo: z.number().int(),
  providerTransactionId: z.string(),
});
const purchaseJob = z.object({ estateId: z.uuid(), purchaseId: z.uuid() });

/**
 * `utilities` queue (ADR-0018): verified platform charges become paid purchases, vends with retries,
 * refunds, and a 5-minute sweep that alerts on anything paid but not vended or refunded in 15 minutes.
 */
@Injectable()
export class PurchasesConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PurchasesConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly purchases: PurchasesService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queues
      .queue(QUEUES.utilities)
      .upsertJobScheduler('utilities-sweep', { every: 5 * 60_000 }, { name: 'utilities.sweep' });
    this.worker = new Worker(
      QUEUES.utilities,
      async (job) => {
        if (job.name === 'utilities.sweep') {
          for (const estateId of await this.tenancy.estateIdsWithFeature('billing'))
            await this.purchases.sweep(estateId);
          return;
        }
        if (job.name === 'utilities.vend') {
          const { estateId, purchaseId } = purchaseJob.parse(job.data);
          const result = await this.purchases.vend(estateId, purchaseId);
          if (result === 'retry')
            await this.purchases.retryVend(
              estateId,
              purchaseId,
              await this.purchases.attemptsOf(estateId, purchaseId),
            );
          return;
        }
        if (job.name === 'utilities.refund') {
          const { estateId, purchaseId } = purchaseJob.parse(job.data);
          await this.purchases.refund(estateId, purchaseId);
          return;
        }
        // Outbox events relayed to this queue.
        const event = job.data as RelayedEvent;
        if (!event.estateId) return;
        if (event.type === 'payments.platform_charge.succeeded') {
          const charge = chargeEvent.parse(event.payload);
          await this.purchases.handlePaid(
            event.estateId,
            charge.reference,
            charge.amountKobo,
            charge.providerTransactionId,
          );
        } else if (event.type === 'payments.platform_charge.failed') {
          await this.purchases.handleChargeFailed(
            event.estateId,
            chargeEvent.parse(event.payload).reference,
          );
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
        msg: 'utilities job failed',
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
