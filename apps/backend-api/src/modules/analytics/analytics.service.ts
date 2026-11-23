import { Injectable } from '@nestjs/common';
import type { createReportScheduleSchema, ingestProductEventsSchema } from '@safezone/schemas';
import { z } from 'zod';
import type { AuthContext, EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { dateOnly, parseDateOnly, todayInLagos, toKobo } from '../billing/domain/billing';
import {
  applySmallNumberSuppression,
  DEFAULT_SUPPRESSION_THRESHOLD,
  safePercent,
  stripPiiProperties,
} from './domain/analytics';

/**
 * Deeper Analytics & Reporting (analytics.md, Phase 5; ADR-0026).
 * Reads from event-driven `analytics.rm_*` projections, stores PII-stripped product events,
 * manages scheduled estate reports, and serves suppressed platform KPIs.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  async estateDashboard(access: EstateAccess, from?: string, to?: string) {
    const toDate = to ?? todayInLagos();
    const fromDate = from ?? toDate.slice(0, 8) + '01';
    const start = parseDateOnly(fromDate);
    const end = parseDateOnly(toDate);
    const startMonth = fromDate.slice(0, 7);
    const endMonth = toDate.slice(0, 7);

    return this.db.withTenant(access, async (tx) => {
      const [gateRows, sosRows, colRows, mntRows, commRows] = await Promise.all([
        tx.rmGateDaily.findMany({
          where: { estateId: access.estateId, day: { gte: start, lte: end } },
        }),
        tx.rmSosMetrics.findMany({
          where: { estateId: access.estateId, day: { gte: start, lte: end } },
        }),
        tx.rmCollectionsMonthly.findMany({
          where: { estateId: access.estateId, month: { gte: startMonth, lte: endMonth } },
        }),
        tx.rmMaintenanceSla.findMany({
          where: { estateId: access.estateId, day: { gte: start, lte: end } },
        }),
        tx.rmCommunityDaily.findMany({
          where: { estateId: access.estateId, day: { gte: start, lte: end } },
        }),
      ]);

      const entries = gateRows.reduce((s, r) => s + r.entries, 0);
      const exits = gateRows.reduce((s, r) => s + r.exits, 0);
      const digitalEntries = gateRows.reduce((s, r) => s + r.digitalEntries, 0);
      const denies = gateRows.reduce((s, r) => s + r.denies, 0);
      const overrides = gateRows.reduce((s, r) => s + r.overrides, 0);

      const realAlerts = sosRows.reduce((s, r) => s + r.realAlerts, 0);
      const drillAlerts = sosRows.reduce((s, r) => s + r.drillAlerts, 0);
      const ackSum = sosRows.reduce((s, r) => s + r.ackSecondsSum, 0);
      const ackCount = sosRows.reduce((s, r) => s + r.ackCount, 0);
      const resSum = sosRows.reduce((s, r) => s + r.resolveSecondsSum, 0);
      const resCount = sosRows.reduce((s, r) => s + r.resolveCount, 0);

      const billedKobo = colRows.reduce((s, r) => s + toKobo(r.billedKobo), 0);
      const collectedKobo = colRows.reduce((s, r) => s + toKobo(r.collectedKobo), 0);
      const digitalCollectedKobo = colRows.reduce((s, r) => s + toKobo(r.digitalCollectedKobo), 0);

      const opened = mntRows.reduce((s, r) => s + r.opened, 0);
      const resolved = mntRows.reduce((s, r) => s + r.resolved, 0);
      const breached = mntRows.reduce((s, r) => s + r.breached, 0);
      const resMinSum = mntRows.reduce((s, r) => s + r.resolveMinutesSum, 0);

      const posts = commRows.reduce((s, r) => s + r.posts, 0);
      const reactions = commRows.reduce((s, r) => s + r.reactions, 0);
      const activeUsers = commRows.reduce((max, r) => Math.max(max, r.activeUsers), 0);

      return {
        estateId: access.estateId,
        from: fromDate,
        to: toDate,
        gate: {
          entries,
          exits,
          digitalEntriesPercent: safePercent(digitalEntries, entries),
          denies,
          overrides,
        },
        sos: {
          realAlerts,
          drillAlerts,
          avgAckSeconds: ackCount > 0 ? Math.round(ackSum / ackCount) : null,
          avgResolveSeconds: resCount > 0 ? Math.round(resSum / resCount) : null,
        },
        collections: {
          billedKobo,
          collectedKobo,
          digitalPercent: safePercent(digitalCollectedKobo, collectedKobo),
        },
        maintenance: {
          opened,
          resolved,
          breached,
          avgResolveMinutes: resolved > 0 ? Math.round(resMinSum / resolved) : null,
        },
        community: { posts, reactions, activeUsers },
      };
    });
  }

  async listReportSchedules(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.reportSchedule.findMany({
        where: { estateId: access.estateId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        reportKey: r.reportKey as
          | 'operations_summary'
          | 'collections'
          | 'security_patrols'
          | 'maintenance_sla'
          | 'procurement_spend'
          | 'workforce_attendance',
        frequency: r.frequency as 'weekly' | 'monthly',
        recipients: r.recipients,
        format: 'csv' as const,
        active: r.active,
        lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async createReportSchedule(
    access: EstateAccess,
    input: z.infer<typeof createReportScheduleSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const r = await tx.reportSchedule.create({
        data: {
          estateId: access.estateId,
          reportKey: input.reportKey,
          frequency: input.frequency,
          recipients: input.recipients,
          format: input.format,
          createdBy: access.userId,
        },
      });
      return {
        id: r.id,
        reportKey: r.reportKey as
          | 'operations_summary'
          | 'collections'
          | 'security_patrols'
          | 'maintenance_sla'
          | 'procurement_spend'
          | 'workforce_attendance',
        frequency: r.frequency as 'weekly' | 'monthly',
        recipients: r.recipients,
        format: 'csv' as const,
        active: r.active,
        lastSentAt: null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async deleteReportSchedule(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.reportSchedule.findFirst({
        where: { estateId: access.estateId, id },
      });
      if (!existing) throw new NotFoundError('Report schedule not found', 'SCHEDULE_NOT_FOUND');
      await tx.reportSchedule.delete({ where: { id } });
      return { deleted: true, id };
    });
  }

  async ingestProductEvents(auth: AuthContext, input: z.infer<typeof ingestProductEventsSchema>) {
    await this.db.withContext('analytics', async (tx) => {
      await tx.productEvent.createMany({
        data: input.events.map((e) => ({
          occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
          estateId: e.estateId ?? null,
          userId: auth.userId,
          app: e.app,
          version: e.version,
          event: e.event,
          properties: stripPiiProperties(e.properties),
        })),
      });
    });
    return { accepted: input.events.length };
  }

  async platformKpis() {
    const today = todayInLagos();
    return this.db.withContext('analytics', async (tx) => {
      const latest = await tx.rmPlatformDaily.findFirst({ orderBy: { day: 'desc' } });
      const mau = latest?.mau ?? 0;
      const suppression = applySmallNumberSuppression(mau, DEFAULT_SUPPRESSION_THRESHOLD);
      const impressions = latest?.adImpressions ?? 0;
      const clicks = latest?.adClicks ?? 0;
      return {
        asOf: latest ? dateOnly(latest.day) : today,
        suppressionThreshold: DEFAULT_SUPPRESSION_THRESHOLD,
        activeEstates: latest?.activeEstates ?? 0,
        totalUsers: latest?.totalUsers ?? 0,
        monthlyActiveUsers: suppression.value,
        suppressed: suppression.suppressed,
        txVolumeKobo: toKobo(latest?.txVolumeKobo ?? 0n),
        adRevenueKobo: toKobo(latest?.adRevenueKobo ?? 0n),
        marketplaceCommissionKobo: toKobo(latest?.marketplaceCommissionKobo ?? 0n),
        adImpressions: impressions,
        adClicks: clicks,
        adCtrPercent: safePercent(clicks, impressions),
      };
    });
  }
}
