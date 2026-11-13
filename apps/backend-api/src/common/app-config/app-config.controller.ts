import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { compareVersions } from './compare-versions';

const querySchema = z.object({
  app: z.string().min(1),
  platform: z.enum(['android', 'ios', 'web']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

/**
 * GET /v1/public/app-config — tells an app whether it must (hard) or should (soft) update.
 * Versions come from env for now; Phase 0 task 11 moves them to the platform module (per app and platform).
 */
@Controller('v1/public/app-config')
export class AppConfigController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  get(@Query() query: Record<string, string>) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('app, platform and version are required');

    const { version } = parsed.data;
    const minVersion = this.env.APP_MIN_VERSION;
    const recommendedVersion = this.env.APP_RECOMMENDED_VERSION;
    const update =
      compareVersions(version, minVersion) < 0
        ? 'hard'
        : compareVersions(version, recommendedVersion) < 0
          ? 'soft'
          : 'none';

    return { minVersion, recommendedVersion, update } as const;
  }
}
