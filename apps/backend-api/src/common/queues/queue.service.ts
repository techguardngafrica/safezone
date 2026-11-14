import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DEFAULT_JOB_OPTIONS, QUEUE_PREFIX, type QueueName } from './queues';

/** Producer side of BullMQ. One Queue per name, created on first use, sharing one connection. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger('Queues');
  private readonly queues = new Map<QueueName, Queue>();
  private connection: Redis | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      if (!this.connection) {
        this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
        this.connection.on('error', (error: Error) =>
          this.logger.warn({ msg: 'queue redis error', error: error.name }),
        );
      }
      queue = new Queue(name, {
        connection: this.connection,
        prefix: QUEUE_PREFIX,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** `jobId` makes the add idempotent: BullMQ ignores a second add with the same id. */
  async add(
    name: QueueName,
    jobName: string,
    data: unknown,
    options: JobsOptions = {},
  ): Promise<void> {
    await this.queue(name).add(jobName, data, options);
  }

  /** Redis connection settings for workers (they need their own blocking connection). */
  workerConnectionUrl(): string {
    return this.env.REDIS_URL;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    if (this.connection && this.connection.status !== 'end') await this.connection.quit();
  }
}
