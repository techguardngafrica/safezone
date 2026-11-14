import { Controller, Get, Put } from '@nestjs/common';
import {
  appConfigQuerySchema,
  appConfigSchema,
  appVersionParamsSchema,
  featureFlagKeySchema,
  featureFlagSchema,
  myFlagsQuerySchema,
  upsertAppVersionSchema,
  upsertFeatureFlagSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { type AuthContext, Can, CurrentAuth, SignedIn } from '../../common/auth/auth.decorators';
import { Public } from '../../common/auth/public.decorator';
import { Contract, ValidBody, ValidParams, ValidQuery } from '../../common/contract/contract';
import { TenancyService } from '../tenancy/tenancy.service';
import { FeatureFlagsService } from './feature-flags.service';

const flagParamsSchema = z.object({ key: featureFlagKeySchema });

@Controller('v1')
export class PlatformController {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly tenancy: TenancyService,
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
