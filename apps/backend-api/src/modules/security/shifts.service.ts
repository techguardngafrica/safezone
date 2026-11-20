import { Injectable } from '@nestjs/common';
import type { shiftListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { canEndShift, startDecision } from './domain/shifts';
import { GatesService } from './gates.service';
import { IncidentsService } from './incidents.service';

type ShiftRow = Prisma.ShiftSessionGetPayload<object>;

const cursorSchema = z.object({ startedAt: z.iso.datetime(), id: z.uuid() });

/**
 * Shift sessions and handover (security.md §2.5 to §2.7). Phase 1: a guard starts a shift at a gate after
 * signing in, ends it with a handover note, and the next guard sees that note. Rosters, late and absent
 * flags, and device-bound sessions come with personnel records and gate-device registration.
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gates: GatesService,
    private readonly incidents: IncidentsService,
  ) {}

  async start(access: EstateAccess, gateId: string) {
    try {
      return await this.db.withTenant(access, async (tx) => {
        const gate = await this.gates.activeGate(tx, access.estateId, gateId);
        const open = await this.openOf(tx, access.estateId, access.userId);
        const decision = startDecision(open, gateId);
        if (decision === 'conflict')
          throw new ConflictError(
            'SHIFT_ALREADY_OPEN',
            'End your shift at the other gate before starting here',
          );
        if (decision === 'resume' && open) return this.view(open, new Map([[gate.id, gate.name]]));
        const row = await tx.shiftSession.create({
          data: { estateId: access.estateId, userId: access.userId, gateId },
        });
        await this.event(tx, access, row, 'security.shift.started', 'security.shift.start', {
          gateId,
        });
        return this.view(row, new Map([[gate.id, gate.name]]));
      });
    } catch (error) {
      // Two starts racing: the partial unique index keeps one open shift per guard.
      if ((error as { code?: unknown }).code === 'P2002')
        throw new ConflictError('SHIFT_ALREADY_OPEN', 'You already have a shift open');
      throw error;
    }
  }

  async current(access: EstateAccess, gateId: string) {
    const [shifts, openIncidents] = await Promise.all([
      this.db.withTenant(access, async (tx) => {
        await this.gates.activeGate(tx, access.estateId, gateId);
        const [mine, previous] = await Promise.all([
          this.openOf(tx, access.estateId, access.userId),
          tx.shiftSession.findFirst({
            where: { estateId: access.estateId, gateId, endedAt: { not: null } },
            orderBy: { endedAt: 'desc' },
          }),
        ]);
        const names = await this.gateNames(tx, access.estateId, [mine, previous]);
        return {
          mine: mine ? this.view(mine, names) : null,
          previous: previous ? this.view(previous, names) : null,
        };
      }),
      this.incidents.openCount(access),
    ]);
    return { ...shifts, openIncidents };
  }

  async end(access: EstateAccess, shiftId: string, handoverNote: string) {
    const supervisor = access.permissions.has('security.staff.manage');
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.shiftSession.findFirst({
        where: { id: shiftId, estateId: access.estateId },
      });
      // Guards cannot learn about other guards' shifts: not found, not forbidden.
      if (!row || (row.userId !== access.userId && !supervisor))
        throw new NotFoundError('Shift not found', 'SHIFT_NOT_FOUND');
      if (!canEndShift(row.userId, access.userId, supervisor)) throw new ForbiddenError();
      if (row.endedAt) throw new ConflictError('SHIFT_ENDED', 'This shift has already ended');
      const ended = await tx.shiftSession.update({
        where: { id: row.id },
        data: { endedAt: new Date(), handoverNote, endedBy: access.userId },
      });
      await this.event(tx, access, ended, 'security.shift.ended', 'security.shift.end', {
        gateId: row.gateId,
        remote: row.userId !== access.userId,
      });
      const names = await this.gateNames(tx, access.estateId, [ended]);
      return this.view(ended, names);
    });
  }

  /** Attendance (security.md §2.6): shifts by time, newest first. Supervisors only. */
  async list(access: EstateAccess, query: z.infer<typeof shiftListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.shiftSession.findMany({
        where: {
          estateId: access.estateId,
          ...(query.gateId ? { gateId: query.gateId } : {}),
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.open ? { endedAt: null } : {}),
          ...(query.from || query.to
            ? {
                startedAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lt: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(after
            ? {
                OR: [
                  { startedAt: { lt: new Date(after.startedAt) } },
                  { startedAt: new Date(after.startedAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const names = await this.gateNames(tx, access.estateId, page);
      const last = page.at(-1);
      return {
        items: page.map((row) => this.view(row, names)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ startedAt: last.startedAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  private openOf(tx: Tx, estateId: string, userId: string) {
    return tx.shiftSession.findFirst({ where: { estateId, userId, endedAt: null } });
  }

  private async gateNames(tx: Tx, estateId: string, rows: readonly (ShiftRow | null)[]) {
    const ids = [...new Set(rows.filter((row): row is ShiftRow => !!row).map((row) => row.gateId))];
    if (ids.length === 0) return new Map<string, string>();
    const gates = await tx.gate.findMany({
      where: { estateId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(gates.map((gate) => [gate.id, gate.name]));
  }

  private view(row: ShiftRow, names: Map<string, string>) {
    return {
      id: row.id,
      userId: row.userId,
      gateId: row.gateId,
      gateName: names.get(row.gateId) ?? null,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      handoverNote: row.handoverNote,
      endedBy: row.endedBy,
    };
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    row: ShiftRow,
    type: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'shift_session',
        aggregateId: row.id,
        payload: { shiftId: row.id, userId: row.userId, ...details } as Prisma.InputJsonValue,
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action,
          resourceType: 'shift_session',
          resourceId: row.id,
          after: details as Prisma.InputJsonValue,
        },
      },
    ]);
  }

  /** Start and end of shifts started in the window (estate reports). */
  async shiftsBetween(tx: Tx, estateId: string, from: Date, to: Date) {
    return tx.shiftSession.findMany({
      where: { estateId, startedAt: { gte: from, lte: to } },
      select: { startedAt: true, endedAt: true },
    });
  }
}
