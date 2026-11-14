import type { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/** Dedicated blocking connection for a BullMQ Worker (BullMQ requires maxRetriesPerRequest: null). */
export function createWorkerConnection(url: string, logger: Logger): Redis {
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  connection.on('error', (error: Error) =>
    logger.warn({ msg: 'worker redis error', error: error.name }),
  );
  return connection;
}
