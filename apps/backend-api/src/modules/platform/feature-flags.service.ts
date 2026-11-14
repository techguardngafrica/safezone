import { Inject, Injectable } from '@nestjs/common';
import type { upsertAppVersionSchema, upsertFeatureFlagSchema } from '@safezone/schemas';
import type { z } from 'zod';
import { compareVersions } from '../../common/app-config/compare-versions';
import { DatabaseService } from '../../common/database/database.service';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  type FlagDefinition,
  type FlagSubject,
  flagRulesSchema,
  isFlagEnabled,
} from './flag-rules';

interface CachedFlag extends FlagDefinition {
  description: string;
  isPublic: boolean;
  updatedAt: Date;
}

/** Changes reach every instance within this time without a deploy (platform.md §9: within 1 minute). */
const CACHE_TTL_MS = 30_000;

/** Feature flags and app version policy (Phase 0 task 11). */
@Injectable()
export class FeatureFlagsService {
  private cache: { flags: CachedFlag[]; loadedAt: number } | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {}

  async evaluate(subject: FlagSubject, onlyPublic = false): Promise<Record<string, boolean>> {
    const flags = await this.flags();
    return Object.fromEntries(
      flags
        .filter((flag) => !onlyPublic || flag.isPublic)
        .map((flag) => [flag.key, isFlagEnabled(flag, subject)]),
    );
  }

  async isEnabled(key: string, subject: FlagSubject): Promise<boolean> {
    const flag = (await this.flags()).find((candidate) => candidate.key === key);
    return flag ? isFlagEnabled(flag, subject) : false;
  }

  async list() {
    return (await this.flags(true)).map((flag) => ({
      key: flag.key,
      description: flag.description,
      defaultEnabled: flag.defaultEnabled,
      rules: flag.rules,
      isPublic: flag.isPublic,
      updatedAt: flag.updatedAt.toISOString(),
    }));
  }

  async upsert(key: string, input: z.infer<typeof upsertFeatureFlagSchema>, actorId: string) {
    const saved = await this.db.withContext('platform_config', async (tx) => {
      const before = await tx.featureFlag.findUnique({ where: { key } });
      const row = await tx.featureFlag.upsert({
        where: { key },
        create: { key, ...input, updatedBy: actorId },
        update: { ...input, updatedBy: actorId, updatedAt: new Date() },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.flag.changed',
          estateId: null,
          aggregateType: 'feature_flag',
          aggregateId: key,
          payload: { key },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.flag.update',
            resourceType: 'feature_flag',
            resourceId: key,
            before: before
              ? {
                  defaultEnabled: before.defaultEnabled,
                  rules: before.rules ?? {},
                  isPublic: before.isPublic,
                }
              : {},
            after: {
              defaultEnabled: input.defaultEnabled,
              rules: input.rules,
              isPublic: input.isPublic,
            },
          },
        },
      ]);
      return row;
    });
    this.cache = undefined;
    return {
      key: saved.key,
      description: saved.description,
      defaultEnabled: saved.defaultEnabled,
      rules: flagRulesSchema.parse(saved.rules),
      isPublic: saved.isPublic,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /** Version policy for an app and platform; falls back to APP_MIN_VERSION/APP_RECOMMENDED_VERSION. */
  async appConfig(app: string, platform: string, version: string) {
    const row = await this.db.withContext('platform_config', (tx) =>
      tx.appVersion.findUnique({ where: { app_platform: { app, platform } } }),
    );
    const minVersion = row?.minVersion ?? this.env.APP_MIN_VERSION;
    const recommendedVersion = row?.recommendedVersion ?? this.env.APP_RECOMMENDED_VERSION;
    const update =
      compareVersions(version, minVersion) < 0
        ? 'hard'
        : compareVersions(version, recommendedVersion) < 0
          ? 'soft'
          : 'none';
    const flags = await this.evaluate({ app, appVersion: version }, true);
    return {
      minVersion,
      recommendedVersion,
      update,
      message: row?.message ?? null,
      flags,
    } as const;
  }

  async setAppVersion(
    app: string,
    platform: string,
    input: z.infer<typeof upsertAppVersionSchema>,
    actorId: string,
  ) {
    await this.db.withContext('platform_config', async (tx) => {
      await tx.appVersion.upsert({
        where: { app_platform: { app, platform } },
        create: { app, platform, ...input, updatedBy: actorId },
        update: { ...input, updatedBy: actorId, updatedAt: new Date() },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.app_version.changed',
          estateId: null,
          aggregateType: 'app_version',
          aggregateId: `${app}:${platform}`,
          payload: { app, platform },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.app_version.update',
            resourceType: 'app_version',
            resourceId: `${app}:${platform}`,
            after: input,
          },
        },
      ]);
    });
    return { app, platform, ...input };
  }

  private async flags(fresh = false): Promise<CachedFlag[]> {
    if (!fresh && this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.flags;
    }
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.featureFlag.findMany({ orderBy: { key: 'asc' } }),
    );
    const flags = rows.map((row) => {
      const rules = flagRulesSchema.safeParse(row.rules);
      return {
        key: row.key,
        description: row.description,
        defaultEnabled: row.defaultEnabled,
        // A malformed rule set disables targeting rather than failing every request.
        rules: rules.success ? rules.data : {},
        isPublic: row.isPublic,
        updatedAt: row.updatedAt,
      };
    });
    this.cache = { flags, loadedAt: Date.now() };
    return flags;
  }
}
