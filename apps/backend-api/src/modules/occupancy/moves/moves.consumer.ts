import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { z } from 'zod';
import { QueueService } from '../../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../../common/queues/queues';
import { createWorkerConnection } from '../../../common/queues/worker-connection';
import { todayInLagos } from '../../billing/domain/billing';
import { TenancyService } from '../../tenancy/tenancy.service';
import { DocumentsService } from '../../documents/documents.service';
import { MovesService } from './moves.service';

const estateJob = z.object({ estateId: z.uuid(), today: z.iso.date() });

/** Daily at 00:30 WAT on the `occupancy` queue: due move-outs, lease reminders and document expiry reminders. */
@Injectable()
export class MovesConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MovesConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly moves: MovesService,
    private readonly documents: DocumentsService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queues
      .queue(QUEUES.occupancy)
      .upsertJobScheduler(
        'occupancy-daily',
        { pattern: '30 23 * * *', tz: 'UTC' },
        { name: 'occupancy.daily' },
      );
    this.worker = new Worker(
      QUEUES.occupancy,
      async (job) => {
        if (job.name === 'occupancy.daily') {
          const today = todayInLagos(new Date(Date.now() + 3_600_000));
          for (const estateId of await this.tenancy.estateIdsWithFeature('occupancy')) {
            await this.queues.add(
              QUEUES.occupancy,
              'occupancy.estate',
              { estateId, today },
              {
                jobId: `occupancy-estate:${estateId}:${today}`,
              },
            );
          }
          return;
        }
        if (job.name === 'occupancy.estate') {
          const { estateId, today } = estateJob.parse(job.data);
          const result = await this.moves.daily(estateId, today);
          const documentReminders = await this.documents.expiryReminders(estateId, today);
          this.logger.log({ msg: 'occupancy daily done', estateId, ...result, documentReminders });
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
        msg: 'occupancy job failed',
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
