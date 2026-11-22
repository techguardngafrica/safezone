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
import { CampaignsService } from './campaigns.service';

const chargeEvent = z.object({ reference: z.string().min(1), amountKobo: z.number().int() });

/** `ads` queue: the minute schedule job (rule 8) and verified ad invoice payments. Both idempotent. */
@Injectable()
export class AdvertisingConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AdvertisingConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queues
      .queue(QUEUES.ads)
      .upsertJobScheduler('ads-schedule', { every: 60_000 }, { name: 'ads.schedule.transition' });
    this.worker = new Worker(
      QUEUES.ads,
      async (job) => {
        if (job.name === 'ads.schedule.transition') {
          await this.campaigns.sweep();
          return;
        }
        const event = job.data as RelayedEvent;
        if (event.type === 'payments.ad_charge.succeeded') {
          const charge = chargeEvent.parse(event.payload);
          await this.campaigns.handlePaid(charge.reference, charge.amountKobo);
        }
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'ads job failed',
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
