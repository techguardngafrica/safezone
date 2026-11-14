import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/public.decorator';
import { Contract } from '../contract/contract';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.module';

const liveSchema = z.object({ status: z.literal('ok') });
const readySchema = z.object({
  status: z.enum(['ok', 'fail']),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])),
});

@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. */
  @Public()
  @Get('live')
  @Contract({ summary: 'Liveness probe', tags: ['health'], response: liveSchema })
  live() {
    return { status: 'ok' as const };
  }

  /** Readiness: dependencies reachable. 503 when any check fails. */
  @Public()
  @Get('ready')
  @Contract({ summary: 'Readiness probe', tags: ['health'], response: readySchema, errors: [503] })
  async ready() {
    const checks = {
      database: (await this.database.isReady()) ? ('ok' as const) : ('fail' as const),
    };
    if (Object.values(checks).includes('fail')) {
      throw new ServiceUnavailableException('A dependency is unavailable');
    }
    return { status: 'ok' as const, checks };
  }
}
