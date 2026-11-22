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

  async listAppVersions() {
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.appVersion.findMany({ orderBy: [{ app: 'asc' }, { platform: 'asc' }] }),
    );
    return rows.map((row) => ({
      app: row.app as
        | 'resident-mobile'
        | 'management-web'
        | 'management-mobile'
        | 'security-mobile'
        | 'super-admin'
        | 'public-web',
      platform: row.platform as 'android' | 'ios' | 'web',
      minVersion: row.minVersion,
      recommendedVersion: row.recommendedVersion,
      message: row.message,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** Read-only runtime provider summary (secrets never leave the vault/env). */
  listProviders() {
    const isProd = this.env.NODE_ENV === 'production';
    return [
      {
        category: 'sms' as const,
        provider: this.env.SMS_PROVIDER === 'termii' ? 'Termii' : 'Fake SMS (dev)',
        configured: this.env.SMS_PROVIDER === 'termii' ? Boolean(this.env.SMS_API_KEY) : true,
        mode:
          this.env.SMS_PROVIDER === 'fake'
            ? ('fake' as const)
            : isProd
              ? ('live' as const)
              : ('sandbox' as const),
        notes: `Sender ID: ${this.env.SMS_SENDER_ID}`,
      },
      {
        category: 'email' as const,
        provider: this.env.MAIL_TRANSPORT === 'smtp' ? 'Zoho SMTP' : 'File outbox (dev)',
        configured: this.env.MAIL_TRANSPORT === 'smtp' ? Boolean(this.env.MAIL_SMTP_HOST) : true,
        mode:
          this.env.MAIL_TRANSPORT === 'file'
            ? ('fake' as const)
            : isProd
              ? ('live' as const)
              : ('sandbox' as const),
        notes: `From: ${this.env.MAIL_SMTP_FROM}`,
      },
      {
        category: 'push' as const,
        provider: 'Expo Push Notifications',
        configured: true,
        mode: this.env.EXPO_ACCESS_TOKEN
          ? isProd
            ? ('live' as const)
            : ('sandbox' as const)
          : ('sandbox' as const),
        notes: this.env.EXPO_ACCESS_TOKEN ? 'Access token configured' : 'Default Expo push mode',
      },
      {
        category: 'payments' as const,
        provider: this.env.PAYMENTS_PROVIDER === 'paystack' ? 'Paystack' : 'Fake Payments (dev)',
        configured:
          this.env.PAYMENTS_PROVIDER === 'paystack' ? Boolean(this.env.PAYSTACK_SECRET_KEY) : true,
        mode:
          this.env.PAYMENTS_PROVIDER === 'fake'
            ? ('fake' as const)
            : isProd
              ? ('live' as const)
              : ('sandbox' as const),
        notes: 'Direct split settlement to estate subaccounts',
      },
      {
        category: 'storage' as const,
        provider:
          this.env.STORAGE_DRIVER === 's3' ? 'S3-compatible object storage' : 'Local disk (dev)',
        configured: this.env.STORAGE_DRIVER === 's3' ? Boolean(this.env.STORAGE_BUCKET) : true,
        mode:
          this.env.STORAGE_DRIVER === 'local'
            ? ('fake' as const)
            : isProd
              ? ('live' as const)
              : ('sandbox' as const),
        notes: `Bucket: ${this.env.STORAGE_BUCKET}`,
      },
      {
        category: 'utilities' as const,
        provider: this.env.BILLS_PROVIDER ?? 'Not configured',
        configured: Boolean(this.env.BILLS_PROVIDER && this.env.BILLS_API_KEY),
        mode: this.env.BILLS_PROVIDER
          ? isProd
            ? ('live' as const)
            : ('sandbox' as const)
          : ('fake' as const),
        notes: 'Prepaid electricity token aggregator',
      },
    ];
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
