import { Injectable } from '@nestjs/common';
import type { createGateSchema, updateGateSchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import type { TenantContext, Tx } from '../../common/database/tenant-context';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';

type GateRow = Prisma.GateGetPayload<object>;

function toGate(row: GateRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as 'pedestrian' | 'vehicle' | 'both',
    status: row.status as 'active' | 'inactive',
  };
}

/** Gates (security.md §2.1). Other modules use `activeGate`. */
@Injectable()
export class GatesService {
  constructor(private readonly db: DatabaseService) {}

  async list(context: TenantContext) {
    const rows = await this.db.withTenant(context, (tx) =>
      tx.gate.findMany({ where: { estateId: context.estateId }, orderBy: { name: 'asc' } }),
    );
    return rows.map(toGate);
  }

  async create(context: TenantContext, input: z.infer<typeof createGateSchema>) {
    try {
      return await this.db.withTenant(context, async (tx) => {
        const row = await tx.gate.create({ data: { estateId: context.estateId, ...input } });
        await this.audit(
          tx,
          context,
          row.id,
          'security.gate.created',
          'security.gate.create',
          input,
        );
        return toGate(row);
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'P2002') {
        throw new ConflictError('GATE_NAME_TAKEN', 'A gate with this name already exists');
      }
      throw error;
    }
  }

  async update(context: TenantContext, gateId: string, input: z.infer<typeof updateGateSchema>) {
    try {
      return await this.db.withTenant(context, async (tx) => {
        const gate = await tx.gate.findFirst({ where: { id: gateId, estateId: context.estateId } });
        if (!gate) throw new NotFoundError('Gate not found', 'GATE_NOT_FOUND');
        const row = await tx.gate.update({ where: { id: gate.id }, data: input });
        await this.audit(
          tx,
          context,
          row.id,
          'security.gate.updated',
          'security.gate.update',
          input,
        );
        return toGate(row);
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'P2002') {
        throw new ConflictError('GATE_NAME_TAKEN', 'A gate with this name already exists');
      }
      throw error;
    }
  }

  /** An active gate of the estate, inside the caller's transaction. */
  async activeGate(tx: Tx, estateId: string, gateId: string): Promise<GateRow> {
    const gate = await tx.gate.findFirst({ where: { id: gateId, estateId, status: 'active' } });
    if (!gate) throw new NotFoundError('Gate not found', 'GATE_NOT_FOUND');
    return gate;
  }

  async activeCount(estateId: string): Promise<number> {
    return this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.gate.count({ where: { estateId, status: 'active' } }),
    );
  }

  private async audit(
    tx: Tx,
    context: TenantContext,
    gateId: string,
    type: string,
    action: string,
    after: Record<string, unknown>,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: context.estateId,
        aggregateType: 'gate',
        aggregateId: gateId,
        payload: { gateId },
        audit: {
          actorType: 'user',
          actorId: context.userId,
          action,
          resourceType: 'gate',
          resourceId: gateId,
          after: after as Prisma.InputJsonValue,
        },
      },
    ]);
  }
}
