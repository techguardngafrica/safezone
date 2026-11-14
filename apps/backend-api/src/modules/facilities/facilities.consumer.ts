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
import { TenancyService } from '../tenancy/tenancy.service';
import { FacilitiesService } from './facilities.service';

const paid = z.object({ invoiceId: z.uuid() });
const sweepJob = z.object({ estateId: z.uuid() });

/** `facilities` queue: confirms paid bookings (billing.invoice.paid) and sweeps holds every minute. */
@Injectable()
export class FacilitiesConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('FacilitiesConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly facilities: FacilitiesService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queues
      .queue(QUEUES.facilities)
      .upsertJobScheduler('facilities-sweep', { every: 60_000 }, { name: 'facilities.sweep' });
    this.worker = new Worker(
      QUEUES.facilities,
      async (job) => {
        if (job.name === 'facilities.sweep') {
          const slot = Math.floor(Date.now() / 60_000);
          for (const estateId of await this.tenancy.estateIdsWithFeature('facilities')) {
            await this.queues.add(
              QUEUES.facilities,
              'facilities.sweep.estate',
              { estateId },
              { jobId: `facilities-sweep:${estateId}:${slot}` },
            );
          }
          return;
        }
        if (job.name === 'facilities.sweep.estate') {
          await this.facilities.sweep(sweepJob.parse(job.data).estateId);
          return;
        }
        const event = job.data as RelayedEvent;
        if (event.type === 'billing.invoice.paid' && event.estateId) {
          await this.facilities.invoicePaid(event.estateId, paid.parse(event.payload).invoiceId);
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
        msg: 'facilities job failed',
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
