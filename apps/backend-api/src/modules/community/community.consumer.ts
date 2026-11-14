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
import { PollsService } from './polls.service';

const estateJob = z.object({ estateId: z.uuid() });

/** `community` queue: announces closed polls every 5 minutes. */
@Injectable()
export class CommunityConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CommunityConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly polls: PollsService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queues
      .queue(QUEUES.community)
      .upsertJobScheduler('community-polls', { every: 5 * 60_000 }, { name: 'community.polls' });
    this.worker = new Worker(
      QUEUES.community,
      async (job) => {
        if (job.name === 'community.polls') {
          const slot = Math.floor(Date.now() / 300_000);
          for (const estateId of await this.tenancy.estateIdsWithFeature('community')) {
            await this.queues.add(
              QUEUES.community,
              'community.polls.estate',
              { estateId },
              { jobId: `community-polls:${estateId}:${slot}` },
            );
          }
          return;
        }
        if (job.name === 'community.polls.estate')
          await this.polls.closeDue(estateJob.parse(job.data).estateId);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'community job failed',
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
