import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { z } from 'zod';
import { QueueService } from '../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../common/queues/queues';
import { createWorkerConnection } from '../../common/queues/worker-connection';
import { TenancyService } from '../tenancy/tenancy.service';
import { BillingJobsService } from './billing-jobs.service';
import { todayInLagos } from './domain/billing';

const estateJobSchema = z.object({ estateId: z.uuid(), today: z.iso.date() });

/**
 * Worker consumer of the `billing` queue. A job scheduler fires `billing.daily` at 06:00 WAT, which fans out
 * one `billing.estate` job per estate (job id per estate and day, so a day never runs twice).
 */
@Injectable()
export class BillingConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('BillingConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly jobs: BillingJobsService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queues
      .queue(QUEUES.billing)
      .upsertJobScheduler(
        'billing-daily',
        { pattern: '0 5 * * *', tz: 'UTC' },
        { name: 'billing.daily' },
      );
    this.worker = new Worker(
      QUEUES.billing,
      async (job) => {
        if (job.name === 'billing.daily') {
          const today = todayInLagos();
          for (const estateId of await this.tenancy.estateIdsWithFeature('billing')) {
            await this.queues.add(
              QUEUES.billing,
              'billing.estate',
              { estateId, today },
              {
                jobId: `billing-estate:${estateId}:${today}`,
              },
            );
          }
          return;
        }
        if (job.name === 'billing.estate') {
          const { estateId, today } = estateJobSchema.parse(job.data);
          const result = await this.jobs.runDaily(estateId, today);
          this.logger.log({ msg: 'billing daily done', estateId, ...result });
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
        msg: 'billing job failed',
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
