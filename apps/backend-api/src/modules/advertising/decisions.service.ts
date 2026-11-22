import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdCategory, AdPlacementKey, adDecisionQuerySchema } from '@safezone/schemas';
import type { z } from 'zod';
import { DatabaseService } from '../../common/database/database.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { RedisService } from '../../common/redis/redis.module';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FilesService } from '../files/files.service';
import { OccupancyService } from '../occupancy/occupancy.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AdCache } from './ad-cache';
import { normaliseTargeting } from './campaigns.service';
import { contextAllowed, pickWeighted, targetsEstate } from './domain/advertising';

interface Candidate {
  lineItemId: string;
  campaignId: string;
  weight: number;
  cap: number;
  category: AdCategory;
  advertiserName: string;
  creatives: {
    id: string;
    type: 'image_banner';
    imageFileId: string | null;
    headline: string;
    body: string | null;
    cta: string;
  }[];
}

interface TokenBody {
  /** i = impression, c = click */
  t: 'i' | 'c';
  /** One id per decision, shared by its impression and click tokens. */
  n: string;
  c: string;
  l: string;
  cr: string;
  p: string;
  e: string;
  h: string;
  a: string;
  /** Expiry, epoch seconds. */
  x: number;
}

const TOKEN_TTL_SECONDS = 24 * 3600;
const LAGOS_OFFSET_MS = 3_600_000;

function lagosDay(now: Date): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Ad decision service and tracking (advertising.md §6, ADR-0024). Blocked contexts, the Security App and
 * minors get no ad (204). Targeting is estate-level only; users are counted by a salted hash that rotates
 * daily, never by id.
 */
@Injectable()
export class DecisionsService {
  private readonly logger = new Logger('AdDecisions');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly tenancy: TenancyService,
    private readonly occupancy: OccupancyService,
    private readonly files: FilesService,
    private readonly cache: AdCache,
  ) {}

  async decide(
    caller: { userId: string; app: string },
    query: z.infer<typeof adDecisionQuerySchema>,
    now = new Date(),
  ) {
    if (!contextAllowed(query.placement, query.context, caller.app)) return null;
    const membership = await this.tenancy.activeMembership(caller.userId, query.estateId);
    if (!membership) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    if (await this.occupancy.isMinorIn(query.estateId, caller.userId)) return null;
    const access = { estateId: query.estateId, userId: caller.userId };
    const settings = await this.tenancy.getSettings(access);
    if (query.placement === 'management.dashboard.info' && !settings['ads.dashboard_info_enabled'])
      return null;
    const blocked = new Set(settings['ads.blocked_categories']);

    const candidates = (await this.candidates(query.placement, query.estateId, now)).filter(
      (c) => !blocked.has(c.category) && c.creatives.length > 0,
    );
    if (candidates.length === 0) return null;

    const day = lagosDay(now);
    const userHash = this.userHash(caller.userId, day);
    const counts = await this.redis.client.mget(
      ...candidates.map((c) => this.capKey(c.lineItemId, userHash, day)),
    );
    const eligible = candidates.filter((c, index) => Number(counts[index] ?? 0) < c.cap);
    const chosen = pickWeighted(eligible, Math.random());
    if (!chosen) return null;
    const creative = chosen.creatives[Math.floor(Math.random() * chosen.creatives.length)];
    if (!creative) return null;

    const base = {
      n: uuidv7(),
      c: chosen.campaignId,
      l: chosen.lineItemId,
      cr: creative.id,
      p: query.placement,
      e: query.estateId,
      h: userHash,
      a: caller.app,
      x: Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS,
    };
    const api = (this.env.API_PUBLIC_URL ?? '').replace(/\/$/, '');
    return {
      label: 'Sponsored' as const,
      placement: query.placement,
      type: creative.type,
      imageFileId: creative.imageFileId,
      imageUrl: creative.imageFileId ? await this.files.adImageUrl(creative.imageFileId) : null,
      headline: creative.headline,
      body: creative.body,
      cta: creative.cta,
      advertiserName: chosen.advertiserName,
      impressionUrl: `${api}/v1/ads/i/${this.sign({ ...base, t: 'i' })}`,
      clickUrl: `${api}/v1/ads/c/${this.sign({ ...base, t: 'c' })}`,
    };
  }

  /** Impression beacon: counted once per decision; feeds the frequency cap. */
  async impression(token: string): Promise<void> {
    const body = this.verify(token, 'i');
    if (!body) return;
    const inserted = await this.db.withContext('advertising', (tx) =>
      tx.adImpression.createMany({
        data: [
          {
            tokenId: body.n,
            campaignId: body.c,
            lineItemId: body.l,
            creativeId: body.cr,
            placementKey: body.p,
            estateId: body.e,
            userHash: body.h,
            app: body.a,
          },
        ],
        skipDuplicates: true,
      }),
    );
    if (inserted.count === 0) return;
    const day = lagosDay(new Date());
    const key = this.capKey(body.l, body.h, day);
    await this.redis.client
      .multi()
      .incr(key)
      .expire(key, 2 * 86_400)
      .exec();
  }

  /** Click: recorded, then a redirect to the creative's reviewed destination only (rule 13). */
  async click(token: string): Promise<string | null> {
    const body = this.verify(token, 'c');
    if (!body) return null;
    return this.db.withContext('advertising', async (tx) => {
      const creative = await tx.adCreative.findUnique({ where: { id: body.cr } });
      if (!creative || creative.reviewStatus !== 'approved') return null;
      await tx.adClick.create({
        data: {
          tokenId: body.n,
          campaignId: body.c,
          lineItemId: body.l,
          creativeId: body.cr,
          placementKey: body.p,
          estateId: body.e,
          userHash: body.h,
        },
      });
      return creative.destinationUrl;
    });
  }

  private async candidates(
    placement: AdPlacementKey,
    estateId: string,
    now: Date,
  ): Promise<Candidate[]> {
    const key = `${placement}:${estateId}`;
    const cached = this.cache.get<Candidate[]>(key);
    if (cached) return cached;
    const estate = await this.tenancy.estateLocation(estateId);
    const fresh = await this.db.withContext('advertising', async (tx) => {
      const placementRow = await tx.adPlacement.findUnique({ where: { key: placement } });
      if (!placementRow?.active) return [];
      const campaigns = await tx.adCampaign.findMany({
        where: { status: 'active', startsAt: { lte: now }, endsAt: { gt: now } },
        select: { id: true, advertiserId: true },
      });
      if (campaigns.length === 0) return [];
      const advertisers = await tx.advertiser.findMany({
        where: { id: { in: [...new Set(campaigns.map((c) => c.advertiserId))] }, status: 'active' },
        select: { id: true, name: true, category: true },
      });
      const byAdvertiser = new Map(advertisers.map((a) => [a.id, a]));
      const live = campaigns.filter((c) => byAdvertiser.has(c.advertiserId));
      const [lines, creatives] = await Promise.all([
        tx.adLineItem.findMany({
          where: { campaignId: { in: live.map((c) => c.id) }, placementKey: placement },
        }),
        tx.adCreative.findMany({
          where: {
            campaignId: { in: live.map((c) => c.id) },
            active: true,
            reviewStatus: 'approved',
          },
        }),
      ]);
      const campaignAdvertiser = new Map(live.map((c) => [c.id, c.advertiserId]));
      return lines
        .filter((line) =>
          targetsEstate(normaliseTargeting(line.targeting), { id: estateId, state: estate.state }),
        )
        .flatMap((line): Candidate[] => {
          const advertiser = byAdvertiser.get(campaignAdvertiser.get(line.campaignId) ?? '');
          if (!advertiser) return [];
          return [
            {
              lineItemId: line.id,
              campaignId: line.campaignId,
              weight: line.weight,
              cap: line.frequencyCapPerDay ?? placementRow.frequencyCapPerDay,
              category: advertiser.category as AdCategory,
              advertiserName: advertiser.name,
              creatives: creatives
                .filter(
                  (c) => c.campaignId === line.campaignId && placementRow.formats.includes(c.type),
                )
                .map((c) => ({
                  id: c.id,
                  type: c.type as 'image_banner',
                  imageFileId: c.imageFileId,
                  headline: c.headline,
                  body: c.body,
                  cta: c.cta,
                })),
            },
          ];
        });
    });
    this.cache.set(key, fresh);
    return fresh;
  }

  private userHash(userId: string, day: string): string {
    return createHmac('sha256', this.env.ADS_TRACKING_SECRET)
      .update(`user:${userId}:${day}`)
      .digest('base64url')
      .slice(0, 32);
  }

  private capKey(lineItemId: string, userHash: string, day: string): string {
    return `adfc:${lineItemId}:${userHash}:${day}`;
  }

  private sign(body: TokenBody): string {
    const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
    const mac = createHmac('sha256', this.env.ADS_TRACKING_SECRET)
      .update(`token:${payload}`)
      .digest('base64url');
    return `${payload}.${mac}`;
  }

  private verify(token: string, type: 'i' | 'c'): TokenBody | null {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = createHmac('sha256', this.env.ADS_TRACKING_SECRET)
      .update(`token:${payload}`)
      .digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenBody;
      if (body.t !== type || body.x < Math.floor(Date.now() / 1000)) return null;
      return body;
    } catch {
      this.logger.warn({ msg: 'unreadable ad token' });
      return null;
    }
  }
}
