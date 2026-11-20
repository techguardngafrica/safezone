import { Injectable } from '@nestjs/common';
import type { estateReportQuerySchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { InvoicesService } from '../billing/invoices.service';
import { SosService } from '../emergency/sos.service';
import { OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { IncidentsService } from '../security/incidents.service';
import { ShiftsService } from '../security/shifts.service';
import { GateService } from '../visitor/gate.service';
import { PassesService } from '../visitor/passes.service';

function watStart(date: string): Date {
  return new Date(`${date}T00:00:00.000+01:00`);
}
function watEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999+01:00`);
}

/**
 * Estate-wide operational and financial reports (management-web.md §6.12).
 * Every figure comes from the module that owns the data (AGENTS.md §5.1, ADR-0021), all inside one tenant
 * RLS transaction so the report is a consistent snapshot. Projection read models (analytics.md §3) can
 * replace these calls once reports outgrow live queries.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly gate: GateService,
    private readonly passes: PassesService,
    private readonly incidents: IncidentsService,
    private readonly shifts: ShiftsService,
    private readonly sos: SosService,
    private readonly invoices: InvoicesService,
  ) {}

  async summary(access: EstateAccess, query: z.infer<typeof estateReportQuerySchema>) {
    const fromDate = watStart(query.from);
    const toDate = watEnd(query.to);
    const now = new Date();

    return this.db.withTenant(access, async (tx) => {
      const { estateId } = access;
      const [units, residency, gateEvents, activePasses, incidents, sosAlerts, invoices, shifts] =
        await Promise.all([
          this.property.unitCounts(tx, estateId),
          this.occupancy.residencyCounts(tx, estateId),
          this.gate.gateEventsBetween(tx, estateId, fromDate, toDate),
          this.passes.activePassCount(tx, estateId, now),
          this.incidents.incidentsBetween(tx, estateId, fromDate, toDate),
          this.sos.alertsBetween(tx, estateId, fromDate, toDate),
          this.invoices.invoicesCreatedBetween(tx, estateId, fromDate, toDate),
          this.shifts.shiftsBetween(tx, estateId, fromDate, toDate),
        ]);
      const totalUnits = units.total;
      const occupiedUnits = units.occupied;
      const { activeHouseholds, activeResidents } = residency;

      // Visitors
      let entries = 0;
      let exits = 0;
      let denials = 0;
      let overrides = 0;
      for (const ev of gateEvents) {
        if (ev.direction === 'in') entries += 1;
        else exits += 1;
        if (ev.decision === 'deny') denials += 1;
        if (ev.decision === 'override') overrides += 1;
      }

      // Incidents
      const openStatuses = new Set(['reported', 'under_review', 'assigned']);
      let openIncidents = 0;
      let resolvedIncidents = 0;
      const sevMap = new Map<string, number>();
      const catMap = new Map<string, number>();
      for (const inc of incidents) {
        if (openStatuses.has(inc.status)) openIncidents += 1;
        else resolvedIncidents += 1;
        sevMap.set(inc.severity, (sevMap.get(inc.severity) ?? 0) + 1);
        catMap.set(inc.category, (catMap.get(inc.category) ?? 0) + 1);
      }

      // SOS
      const realAlerts = sosAlerts.filter((a) => !a.isDrill);
      const ackDurations = realAlerts
        .filter((a) => a.acknowledgedAt)
        .map((a) =>
          Math.max(0, Math.round((a.acknowledgedAt!.getTime() - a.triggeredAt.getTime()) / 1000)),
        );
      const resolveDurations = realAlerts
        .filter((a) => a.resolvedAt)
        .map((a) =>
          Math.max(0, Math.round((a.resolvedAt!.getTime() - a.triggeredAt.getTime()) / 1000)),
        );
      const avg = (arr: number[]) =>
        arr.length === 0 ? null : Math.round(arr.reduce((sum, n) => sum + n, 0) / arr.length);

      // Finance + Ageing
      let billedKobo = 0;
      let collectedKobo = 0;
      let currentKobo = 0;
      let days30Kobo = 0;
      let days60Kobo = 0;
      let days90PlusKobo = 0;
      for (const inv of invoices) {
        const total = Number(inv.total);
        const paid = Number(inv.amountPaid);
        const owed = Math.max(0, total - paid);
        billedKobo += total;
        collectedKobo += paid;
        if (owed > 0) {
          const daysPastDue = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000);
          if (daysPastDue <= 0) currentKobo += owed;
          else if (daysPastDue <= 30) days30Kobo += owed;
          else if (daysPastDue <= 60) days60Kobo += owed;
          else days90PlusKobo += owed;
        }
      }

      // Attendance
      let openShifts = 0;
      let totalMinutes = 0;
      for (const sh of shifts) {
        if (!sh.endedAt) openShifts += 1;
        const end = sh.endedAt ?? now;
        totalMinutes += Math.max(0, Math.round((end.getTime() - sh.startedAt.getTime()) / 60_000));
      }

      return {
        from: query.from,
        to: query.to,
        generatedAt: now.toISOString(),
        occupancy: {
          totalUnits,
          occupiedUnits,
          vacantUnits: Math.max(0, totalUnits - occupiedUnits),
          activeHouseholds,
          activeResidents,
        },
        visitors: {
          totalEvents: gateEvents.length,
          entries,
          exits,
          denials,
          overrides,
          activePasses,
        },
        incidents: {
          total: incidents.length,
          open: openIncidents,
          resolved: resolvedIncidents,
          bySeverity: [...sevMap.entries()].map(([severity, count]) => ({ severity, count })),
          byCategory: [...catMap.entries()].map(([category, count]) => ({ category, count })),
        },
        sos: {
          total: sosAlerts.length,
          realAlerts: realAlerts.length,
          drills: sosAlerts.length - realAlerts.length,
          avgAckSeconds: avg(ackDurations),
          avgResolveSeconds: avg(resolveDurations),
        },
        finance: {
          billedKobo,
          collectedKobo,
          outstandingKobo: Math.max(0, billedKobo - collectedKobo),
          ageing: {
            currentKobo,
            days30Kobo,
            days60Kobo,
            days90PlusKobo,
          },
        },
        attendance: {
          totalShifts: shifts.length,
          openShifts,
          totalMinutes,
        },
      };
    });
  }
}
