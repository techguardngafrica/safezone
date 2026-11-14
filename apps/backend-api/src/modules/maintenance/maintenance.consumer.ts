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
import { todayInLagos } from '../billing/domain/billing';
import { TenancyService } from '../tenancy/tenancy.service';
import { MaintenanceService } from './maintenance.service';

const estateJob = z.object({ estateId: z.uuid(), today: z.iso.date().optional() });

/**
 * `maintenance-jobs` queue (maintenance.md §8): SLA checks every 5 minutes, and auto-close plus planned work
 * daily at 05:30 WAT. Each fans out per estate with per-estate job ids.
 */
@Injectable()
export class MaintenanceConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MaintenanceConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const queue = this.queues.queue(QUEUES.maintenanceJobs);
    await queue.upsertJobScheduler(
      'maintenance-sla',
      { every: 5 * 60_000 },
      { name: 'maintenance.sla' },
    );
    await queue.upsertJobScheduler(
      'maintenance-daily',
      { pattern: '30 4 * * *', tz: 'UTC' },
      { name: 'maintenance.daily' },
    );
    this.worker = new Worker(
      QUEUES.maintenanceJobs,
      async (job) => {
        if (job.name === 'maintenance.sla' || job.name === 'maintenance.daily') {
          const today = todayInLagos();
          const slot =
            job.name === 'maintenance.sla' ? String(Math.floor(Date.now() / 300_000)) : today;
          for (const estateId of await this.tenancy.estateIdsWithFeature('maintenance')) {
            await this.queues.add(
              QUEUES.maintenanceJobs,
              `${job.name}.estate`,
              { estateId, today },
              {
                jobId: `${job.name}:${estateId}:${slot}`,
              },
            );
          }
          return;
        }
        const { estateId, today } = estateJob.parse(job.data);
        if (job.name === 'maintenance.sla.estate') await this.maintenance.checkSla(estateId);
        if (job.name === 'maintenance.daily.estate')
          await this.maintenance.daily(estateId, today ?? todayInLagos());
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'maintenance job failed',
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
