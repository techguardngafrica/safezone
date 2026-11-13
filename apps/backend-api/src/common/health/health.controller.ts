import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** Liveness: the process is up. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Phase 0 adds Postgres and Redis checks here. */
  @Get('ready')
  ready(): { status: 'ok'; checks: Record<string, 'ok' | 'fail'> } {
    return { status: 'ok', checks: {} };
  }
}
