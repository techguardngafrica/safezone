import { Controller, Get, Put } from '@nestjs/common';
import { t } from '@safezone/i18n';
import {
  appConfigQuerySchema,
  appConfigSchema,
  appVersionParamsSchema,
  appVersionRowSchema,
  featureFlagKeySchema,
  featureFlagSchema,
  myFlagsQuerySchema,
  platformHealthSchema,
  platformNotificationTemplateSchema,
  platformProviderStatusSchema,
  upsertAppVersionSchema,
  upsertFeatureFlagSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, Can, CurrentAuth, SignedIn } from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { DatabaseService } from '../../common/database/database.service';
import { QueueService } from '../../common/queues/queue.service';
import { QUEUES, type QueueName } from '../../common/queues/queues';
import { RedisService } from '../../common/redis/redis.module';
import { INTENTS, type IntentDefinition } from '../notifications/domain/intents';
import { TenancyService } from '../tenancy/tenancy.service';
import { FeatureFlagsService } from './feature-flags.service';

const flagParamsSchema = z.object({ key: featureFlagKeySchema });
const HEALTH_QUEUES: readonly QueueName[] = [
  QUEUES.sos,
  QUEUES.notifications,
  QUEUES.outbox,
  QUEUES.audit,
  QUEUES.billing,
  QUEUES.payments,
  QUEUES.imports,
  QUEUES.exports,
  QUEUES.onboarding,
  QUEUES.utilities,
];

@Controller('v1')
export class PlatformController {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly tenancy: TenancyService,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
  ) {}

  /** Forced/soft update prompts and public flags, before sign-in. */
  @Get('public/app-config')
  @Public()
  @Contract({
    summary: 'App update policy and public flags',
    tags: ['public'],
    query: appConfigQuerySchema,
    response: appConfigSchema,
  })
  appConfig(@ValidQuery() query: z.infer<typeof appConfigQuerySchema>) {
    return this.flags.appConfig(query.app, query.platform, query.version);
  }

  @Get('me/feature-flags')
  @SignedIn()
  @Contract({
    summary: 'Flags evaluated for me (and an estate I belong to)',
    tags: ['me'],
    query: myFlagsQuerySchema,
    response: z.record(z.string(), z.boolean()),
  })
  async myFlags(
    @CurrentAuth() auth: AuthContext,
    @ValidQuery() query: z.infer<typeof myFlagsQuerySchema>,
  ) {
    const estateId =
      query.estateId && (await this.tenancy.activeMembership(auth.userId, query.estateId))
        ? query.estateId
        : null;
    return this.flags.evaluate({ userId: auth.userId, estateId, app: auth.app });
  }

  @Get('platform/feature-flags')
  @Can('platform.config')
  @Contract({
    summary: 'All feature flags',
    tags: ['platform'],
    response: z.array(featureFlagSchema),
  })
  listFlags() {
    return this.flags.list();
  }

  @Put('platform/feature-flags/:key')
  @Can('platform.config')
  @Contract({
    summary: 'Create or change a feature flag',
    tags: ['platform'],
    params: flagParamsSchema,
    body: upsertFeatureFlagSchema,
    response: featureFlagSchema,
  })
  upsertFlag(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof flagParamsSchema>,
    @ValidBody() body: z.infer<typeof upsertFeatureFlagSchema>,
  ) {
    return this.flags.upsert(params.key, body, auth.userId);
  }

  @Get('platform/app-versions')
  @Can('platform.config')
  @Contract({
    summary: 'List all configured app version policies',
    tags: ['platform'],
    response: z.array(appVersionRowSchema),
  })
  listAppVersions() {
    return this.flags.listAppVersions();
  }

  @Get('platform/providers')
  @Can('platform.config')
  @Contract({
    summary: 'Read-only runtime status of configured external providers',
    tags: ['platform'],
    response: z.array(platformProviderStatusSchema),
  })
  listProviders() {
    return this.flags.listProviders();
  }

  @Get('platform/notification-templates')
  @Can('platform.config')
  @Contract({
    summary: 'Catalogue of platform notification intents and default English copy',
    tags: ['platform'],
    response: z.array(platformNotificationTemplateSchema),
  })
  listNotificationTemplates() {
    return Object.entries(INTENTS).map(([intent, def]: [string, IntentDefinition]) => ({
      intent,
      category: def.category,
      priority: def.priority,
      mandatory: def.mandatory,
      channels: [...def.channels],
      smsOnlyWithoutPush: def.smsOnlyWithoutPush,
      titleKey: def.title,
      bodyKey: def.body,
      smsKey: def.sms ?? null,
      titleText: t(def.title),
      bodyText: t(def.body),
      smsText: def.sms ? t(def.sms) : null,
    }));
  }

  @Get('platform/health')
  @Can('platform.config')
  @Contract({
    summary: 'Platform infrastructure and BullMQ queue health',
    tags: ['platform'],
    response: platformHealthSchema,
  })
  async platformHealth() {
    const [dbReady, redisReady] = await Promise.all([this.db.isReady(), this.redis.isReady()]);
    const queues = redisReady
      ? await Promise.all(
          HEALTH_QUEUES.map(async (name) => {
            try {
              const counts = await this.queues
                .queue(name)
                .getJobCounts('waiting', 'active', 'delayed', 'failed');
              return {
                name,
                waiting: counts.waiting ?? 0,
                active: counts.active ?? 0,
                delayed: counts.delayed ?? 0,
                failed: counts.failed ?? 0,
              };
            } catch {
              return { name, waiting: 0, active: 0, delayed: 0, failed: 0 };
            }
          }),
        )
      : HEALTH_QUEUES.map((name) => ({ name, waiting: 0, active: 0, delayed: 0, failed: 0 }));
    return {
      status: dbReady && redisReady ? ('ok' as const) : ('degraded' as const),
      checkedAt: new Date().toISOString(),
      checks: {
        database: dbReady ? ('ok' as const) : ('fail' as const),
        redis: redisReady ? ('ok' as const) : ('fail' as const),
      },
      queues,
    };
  }

  @Put('platform/app-versions/:app/:platform')
  @Can('platform.config')
  @Contract({
    summary: 'Set minimum and recommended app versions',
    tags: ['platform'],
    params: appVersionParamsSchema,
    body: upsertAppVersionSchema,
    response: appVersionParamsSchema.extend({
      minVersion: z.string(),
      recommendedVersion: z.string(),
      message: z.string().nullable(),
    }),
  })
  setAppVersion(
    @CurrentAuth() auth: AuthContext,
    @ValidParams() params: z.infer<typeof appVersionParamsSchema>,
    @ValidBody() body: z.infer<typeof upsertAppVersionSchema>,
  ) {
    return this.flags.setAppVersion(params.app, params.platform, body, auth.userId);
  }
}
