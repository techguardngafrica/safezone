import { Injectable } from '@nestjs/common';
import type {
  bulkCreateSpacesSchema,
  createSpaceSchema,
  spaceListQuerySchema,
  SpaceView,
  unitSearchQuerySchema,
  updateSpaceSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import type { TenantContext, Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  childPath,
  isWithin,
  MAX_TREE_DEPTH,
  placementError,
  planBulk,
  propertyIdentifier,
  type SpaceType,
} from './domain/spaces';

type SpaceRow = Prisma.SpaceGetPayload<object>;

const cursorSchema = z.object({ code: z.string(), id: z.uuid() });
const BULK_INSERT_CHUNK = 500;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

function codeTaken(): ConflictError {
  return new ConflictError(
    'SPACE_CODE_TAKEN',
    'That code is already used (unit codes must be unique in the estate, other codes among siblings)',
  );
}

/**
 * Property module, Phase 1 (property.md): the spaces tree. Owns `tenant.spaces`; other modules use this
 * service (unit lookups for occupancy and visitors, the setup wizard's `spaces` step).
 */
@Injectable()
export class PropertyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
  ) {}

  async list(context: TenantContext, query: z.infer<typeof spaceListQuerySchema>) {
    const after = this.cursor(query.cursor);
    const estateCode = await this.estateCode(context);
    const rows = await this.db.withTenant(context, (tx) =>
      tx.space.findMany({
        where: {
          estateId: context.estateId,
          parentId: query.parentId ?? null,
          ...(query.type ? { type: query.type } : {}),
          ...(query.includeArchived ? {} : { archivedAt: null }),
          ...(after
            ? { OR: [{ code: { gt: after.code } }, { code: after.code, id: { gt: after.id } }] }
            : {}),
        },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      }),
    );
    return this.page(rows, query.limit, estateCode);
  }

  async get(context: TenantContext, spaceId: string): Promise<SpaceView> {
    const estateCode = await this.estateCode(context);
    const row = await this.db.withTenant(context, (tx) => this.load(tx, context.estateId, spaceId));
    return this.view(row, estateCode);
  }

  /** Unit search; `withinId` uses the path prefix index ("all units in Block C"). */
  async units(context: TenantContext, query: z.infer<typeof unitSearchQuerySchema>) {
    const after = this.cursor(query.cursor);
    const estateCode = await this.estateCode(context);
    const rows = await this.db.withTenant(context, async (tx) => {
      const within = query.withinId ? await this.load(tx, context.estateId, query.withinId) : null;
      return tx.space.findMany({
        where: {
          estateId: context.estateId,
          type: 'unit',
          archivedAt: null,
          ...(within ? { path: { startsWith: `${within.path}.` } } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.q
            ? {
                AND: [
                  {
                    OR: [
                      { code: { contains: query.q, mode: 'insensitive' } },
                      { name: { contains: query.q, mode: 'insensitive' } },
                    ],
                  },
                ],
              }
            : {}),
          ...(after
            ? { OR: [{ code: { gt: after.code } }, { code: after.code, id: { gt: after.id } }] }
            : {}),
        },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
    });
    return this.page(rows, query.limit, estateCode);
  }

  async create(
    context: TenantContext,
    input: z.infer<typeof createSpaceSchema>,
  ): Promise<SpaceView> {
    this.assertUnitFields(input.type, input);
    const estateCode = await this.estateCode(context);
    try {
      return await this.db.withTenant(context, async (tx) => {
        const parent = input.parentId
          ? await this.liveParent(tx, context.estateId, input.parentId)
          : null;
        this.assertPlacement(parent, input.type, 0);
        const id = uuidv7();
        const isUnit = input.type === 'unit';
        const row = await tx.space.create({
          data: {
            id,
            estateId: context.estateId,
            parentId: parent?.id ?? null,
            type: input.type,
            code: input.code,
            name: input.name ?? input.code,
            path: childPath(parent?.path ?? null, id),
            depth: (parent?.depth ?? 0) + 1,
            unitType: isUnit ? (input.unitType ?? 'other') : null,
            bedrooms: isUnit ? (input.bedrooms ?? null) : null,
            sizeSqm: input.sizeSqm ?? null,
            status: isUnit ? (input.status ?? 'vacant') : null,
            externalRef: input.externalRef ?? null,
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'property.space.created',
            estateId: context.estateId,
            aggregateType: 'space',
            aggregateId: id,
            payload: { spaceId: id, type: input.type, parentId: parent?.id ?? null },
            audit: {
              actorType: 'user',
              actorId: context.userId,
              action: 'property.space.create',
              resourceType: 'space',
              resourceId: id,
              after: { type: input.type, code: input.code },
            },
          },
        ]);
        return this.view(row, estateCode);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
  }

  /** Pattern-based creation (property.md §5.1). One transaction: all or nothing. */
  async bulkCreate(context: TenantContext, input: z.infer<typeof bulkCreateSpacesSchema>) {
    const parent = input.parentId
      ? await this.db.withTenant(context, (tx) =>
          this.liveParent(tx, context.estateId, input.parentId as string),
        )
      : null;
    let plan;
    try {
      plan = planBulk(
        { type: (parent?.type as SpaceType | undefined) ?? null, code: parent?.code ?? null },
        input.levels,
      );
    } catch (error) {
      throw new DomainError(
        'BULK_PLAN_INVALID',
        error instanceof Error ? error.message : 'Invalid pattern',
        422,
      );
    }
    if ((parent?.depth ?? 0) + input.levels.length > MAX_TREE_DEPTH) {
      throw new DomainError(
        'SPACE_TOO_DEEP',
        `The tree can be at most ${MAX_TREE_DEPTH} levels deep`,
        422,
      );
    }
    const byType: Record<string, number> = {};
    for (const space of plan) byType[space.type] = (byType[space.type] ?? 0) + 1;
    const summary = {
      dryRun: input.dryRun,
      total: plan.length,
      byType,
      sample: plan.slice(0, 10).map(({ type, code, name }) => ({ type, code, name })),
    };

    const unitCodes = plan
      .filter((space) => space.type === 'unit')
      .map((space) => space.code.toLowerCase());
    if (new Set(unitCodes).size !== unitCodes.length) {
      throw new DomainError(
        'BULK_PLAN_INVALID',
        'The pattern produces the same unit code twice',
        422,
      );
    }
    const clashes = await this.db.withTenant(context, (tx) =>
      unitCodes.length === 0
        ? Promise.resolve([] as { code: string }[])
        : tx.$queryRaw<{ code: string }[]>`
            select code from tenant.spaces
             where estate_id = ${context.estateId}::uuid and type = 'unit' and archived_at is null
               and lower(code) = any(${unitCodes}::text[])
             limit 20`,
    );
    if (clashes.length > 0) {
      throw new DomainError(
        'SPACE_CODE_TAKEN',
        `Some unit codes already exist: ${clashes.map((clash) => clash.code).join(', ')}`,
        409,
      );
    }
    if (input.dryRun) return summary;

    try {
      await this.db.withTenant(
        context,
        async (tx) => {
          const rows: Prisma.SpaceCreateManyInput[] = [];
          for (const space of plan) {
            const id = uuidv7();
            const parentRow = space.parentIndex === -1 ? parent : rows[space.parentIndex];
            const parentPath = parentRow ? parentRow.path : null;
            rows.push({
              id,
              estateId: context.estateId,
              parentId: parentRow?.id ?? null,
              type: space.type,
              code: space.code,
              name: space.name,
              path: childPath(parentPath, id),
              depth: (parentRow?.depth ?? 0) + 1,
              unitType: space.unitType,
              status: space.type === 'unit' ? 'vacant' : null,
            });
          }
          for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
            await tx.space.createMany({ data: rows.slice(start, start + BULK_INSERT_CHUNK) });
          }
          await appendOutboxEvents(tx, [
            {
              type: 'property.space.bulk_created',
              estateId: context.estateId,
              aggregateType: 'space',
              aggregateId: parent?.id ?? context.estateId,
              payload: { parentId: parent?.id ?? null, total: rows.length, byType },
              audit: {
                actorType: 'user',
                actorId: context.userId,
                action: 'property.space.bulk_create',
                resourceType: 'space',
                resourceId: parent?.id ?? null,
                after: { total: rows.length, byType },
              },
            },
          ]);
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
    return summary;
  }

  /** Update and re-parent (property.md §4.7): the subtree's paths move in the same transaction. */
  async update(
    context: TenantContext,
    spaceId: string,
    input: z.infer<typeof updateSpaceSchema>,
    expectedVersion?: number,
  ): Promise<SpaceView> {
    const estateCode = await this.estateCode(context);
    try {
      return await this.db.withTenant(context, async (tx) => {
        const space = await this.load(tx, context.estateId, spaceId);
        if (space.archivedAt)
          throw new ConflictError('SPACE_ARCHIVED', 'Archived spaces cannot be changed');
        if (expectedVersion !== undefined && expectedVersion !== space.version) {
          throw new ConflictError(
            'VERSION_MISMATCH',
            'This space was changed by someone else. Reload and try again.',
          );
        }
        this.assertUnitFields(space.type as SpaceType, input);

        const data: Prisma.SpaceUpdateManyMutationInput = { version: { increment: 1 } };
        if (input.code !== undefined) data.code = input.code;
        if (input.name !== undefined) data.name = input.name;
        if (input.unitType !== undefined) data.unitType = input.unitType;
        if (input.bedrooms !== undefined) data.bedrooms = input.bedrooms;
        if (input.sizeSqm !== undefined) data.sizeSqm = input.sizeSqm;
        if (input.status !== undefined) data.status = input.status;

        const moving = input.parentId !== undefined && input.parentId !== space.parentId;
        if (moving) {
          const parent = input.parentId
            ? await this.liveParent(tx, context.estateId, input.parentId)
            : null;
          if (parent && isWithin(parent.path, space.path)) {
            throw new DomainError(
              'SPACE_INVALID_PARENT',
              'A space cannot be moved inside itself',
              422,
            );
          }
          const subtreeDepth = await tx.space.aggregate({
            where: {
              estateId: context.estateId,
              OR: [{ id: space.id }, { path: { startsWith: `${space.path}.` } }],
            },
            _max: { depth: true },
          });
          const delta = (parent?.depth ?? 0) + 1 - space.depth;
          this.assertPlacement(
            parent,
            space.type as SpaceType,
            (subtreeDepth._max.depth ?? space.depth) - space.depth,
          );
          const newPath = childPath(parent?.path ?? null, space.id);
          await tx.$executeRaw`
            update tenant.spaces
               set path = ${newPath} || substr(path, ${space.path.length + 1}),
                   depth = depth + ${delta},
                   updated_at = now()
             where estate_id = ${context.estateId}::uuid
               and (path = ${space.path} or path like ${`${space.path}.%`})`;
          await tx.space.update({
            where: { id: space.id },
            data: { parentId: parent?.id ?? null },
          });
        }

        const updated = await tx.space.updateMany({
          where: { id: space.id, estateId: context.estateId, version: space.version },
          data,
        });
        if (updated.count === 0) {
          throw new ConflictError(
            'VERSION_MISMATCH',
            'This space was changed by someone else. Reload and try again.',
          );
        }
        await appendOutboxEvents(tx, [
          {
            type: 'property.space.updated',
            estateId: context.estateId,
            aggregateType: 'space',
            aggregateId: space.id,
            payload: { spaceId: space.id, fields: Object.keys(input), moved: moving },
            audit: {
              actorType: 'user',
              actorId: context.userId,
              action: 'property.space.update',
              resourceType: 'space',
              resourceId: space.id,
              before: Object.fromEntries(
                Object.keys(input).map((key) => [
                  key,
                  (space as Record<string, unknown>)[key] ?? null,
                ]),
              ) as Prisma.InputJsonValue,
              after: input as Prisma.InputJsonValue,
            },
          },
        ]);
        return this.view(await this.load(tx, context.estateId, space.id), estateCode);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
  }

  /**
   * Archive (property.md §4.6): only leaves. Occupancy and billing add their own checks (active
   * occupancy, open invoices) when they land.
   */
  async archive(context: TenantContext, spaceId: string): Promise<SpaceView> {
    const estateCode = await this.estateCode(context);
    return this.db.withTenant(context, async (tx) => {
      const space = await this.load(tx, context.estateId, spaceId);
      if (space.archivedAt) return this.view(space, estateCode);
      const children = await tx.space.count({
        where: { estateId: context.estateId, parentId: space.id, archivedAt: null },
      });
      if (children > 0) {
        throw new ConflictError('SPACE_HAS_CHILDREN', 'Archive or move the spaces inside it first');
      }
      if (space.type === 'unit' && space.status === 'occupied') {
        throw new ConflictError('SPACE_OCCUPIED', 'An occupied unit cannot be archived');
      }
      await tx.space.update({
        where: { id: space.id },
        data: { archivedAt: new Date(), version: { increment: 1 } },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'property.space.archived',
          estateId: context.estateId,
          aggregateType: 'space',
          aggregateId: space.id,
          payload: { spaceId: space.id, type: space.type },
          audit: {
            actorType: 'user',
            actorId: context.userId,
            action: 'property.space.archive',
            resourceType: 'space',
            resourceId: space.id,
          },
        },
      ]);
      return this.view(await this.load(tx, context.estateId, space.id), estateCode);
    });
  }

  /** A live unit, or null. For other modules' checks. */
  async unit(tx: Tx, estateId: string, spaceId: string) {
    const row = await tx.space.findFirst({
      where: { id: spaceId, estateId, type: 'unit', archivedAt: null },
      select: { id: true, code: true, name: true, status: true, path: true },
    });
    return row;
  }

  /** Code and name of spaces by id (other modules' views). */
  async spacesByIds(tx: Tx, estateId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    return tx.space.findMany({
      where: { estateId, id: { in: [...new Set(ids)] } },
      select: { id: true, code: true, name: true },
    });
  }

  /** Live units at or below any of these spaces (announcement audiences). */
  async unitIdsWithin(tx: Tx, estateId: string, spaceIds: readonly string[]): Promise<string[]> {
    const roots = await tx.space.findMany({
      where: { estateId, id: { in: [...spaceIds] }, archivedAt: null },
      select: { id: true, path: true, type: true },
    });
    if (roots.length !== new Set(spaceIds).size)
      throw new NotFoundError('Space not found', 'SPACE_NOT_FOUND');
    const units = await tx.space.findMany({
      where: {
        estateId,
        type: 'unit',
        archivedAt: null,
        OR: roots.flatMap((root) => [{ id: root.id }, { path: { startsWith: `${root.path}.` } }]),
      },
      select: { id: true },
    });
    return units.map((unit) => unit.id);
  }

  /**
   * Live units a charge applies to (billing): at or below `spaceIds` (all units when empty), optionally
   * only some unit types. Ordered by code.
   */
  async billableUnits(
    tx: Tx,
    estateId: string,
    filter: { spaceIds: readonly string[]; unitTypes: readonly string[] },
  ) {
    const unitIds =
      filter.spaceIds.length > 0 ? await this.unitIdsWithin(tx, estateId, filter.spaceIds) : null;
    return tx.space.findMany({
      where: {
        estateId,
        type: 'unit',
        archivedAt: null,
        ...(unitIds ? { id: { in: unitIds } } : {}),
        ...(filter.unitTypes.length > 0 ? { unitType: { in: [...filter.unitTypes] } } : {}),
      },
      select: { id: true, code: true, unitType: true, bedrooms: true, sizeSqm: true, status: true },
      orderBy: [{ code: 'asc' }],
    });
  }

  /** Active owners per unit, largest share first (then longest held). Billing and owner approvals. */
  async activeOwners(tx: Tx, estateId: string, spaceIds: readonly string[]) {
    const result = new Map<string, { userId: string; name: string; shareBp: number }[]>();
    if (spaceIds.length === 0) return result;
    const rows = await tx.ownership.findMany({
      where: { estateId, status: 'active', spaceId: { in: [...spaceIds] } },
      select: {
        spaceId: true,
        ownerUserId: true,
        ownerName: true,
        ownerCompanyName: true,
        shareBp: true,
      },
      orderBy: [{ shareBp: 'desc' }, { startsOn: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      const list = result.get(row.spaceId) ?? [];
      list.push({
        userId: row.ownerUserId,
        name: row.ownerCompanyName ?? row.ownerName,
        shareBp: row.shareBp,
      });
      result.set(row.spaceId, list);
    }
    return result;
  }

  /** Nearest building or block above each unit (building channels, community.md §2.4). */
  async buildingsOfUnits(tx: Tx, estateId: string, unitIds: readonly string[]) {
    const result = new Map<string, { id: string; code: string; name: string }>();
    if (unitIds.length === 0) return result;
    const units = await tx.space.findMany({
      where: { estateId, id: { in: [...unitIds] } },
      select: { id: true, path: true },
    });
    const toUuid = (hex: string) =>
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const ancestorIds = [
      ...new Set(units.flatMap((unit) => unit.path.split('.').slice(0, -1).map(toUuid))),
    ];
    const buildings = await tx.space.findMany({
      where: {
        estateId,
        id: { in: ancestorIds },
        type: { in: ['building', 'block'] },
        archivedAt: null,
      },
      select: { id: true, code: true, name: true, depth: true },
    });
    const byId = new Map(buildings.map((building) => [building.id, building]));
    for (const unit of units) {
      const nearest = unit.path
        .split('.')
        .slice(0, -1)
        .map(toUuid)
        .reverse()
        .map((id) => byId.get(id))
        .find(Boolean);
      if (nearest) result.set(unit.id, { id: nearest.id, code: nearest.code, name: nearest.name });
    }
    return result;
  }

  /** Units the user owns now, with their share. */
  async ownedUnits(tx: Tx, estateId: string, userId: string) {
    const rows = await tx.ownership.findMany({
      where: { estateId, ownerUserId: userId, status: 'active' },
      orderBy: { startsOn: 'asc' },
    });
    const spaces = new Map(
      (
        await tx.space.findMany({
          where: { estateId, id: { in: rows.map((row) => row.spaceId) } },
          select: { id: true, code: true, name: true, status: true },
        })
      ).map((space) => [space.id, space]),
    );
    return rows.map((row) => ({ ownership: row, space: spaces.get(row.spaceId) }));
  }

  /** Occupancy sets units occupied or vacant inside its own transaction. */
  async setUnitStatus(tx: Tx, estateId: string, spaceId: string, status: 'occupied' | 'vacant') {
    await tx.space.updateMany({
      where: { id: spaceId, estateId, type: 'unit' },
      data: { status, version: { increment: 1 } },
    });
  }

  /** Minimal unit list for someone asking to join (code and name only, at most 20). */
  async joinableUnits(estateId: string, userId: string, q: string) {
    return this.db.withTenant({ estateId, userId }, (tx) =>
      tx.space.findMany({
        where: {
          estateId,
          type: 'unit',
          archivedAt: null,
          status: { not: 'under_construction' },
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, code: true, name: true },
        orderBy: [{ code: 'asc' }],
        take: 20,
      }),
    );
  }

  /** Live units in an estate (setup wizard check). */
  async liveUnitCount(estateId: string): Promise<number> {
    return this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.space.count({ where: { estateId, type: 'unit', archivedAt: null } }),
    );
  }

  // ---- Internals -----------------------------------------------------------------------------

  private assertPlacement(
    parent: SpaceRow | null,
    type: SpaceType,
    subtreeExtraDepth: number,
  ): void {
    const problem = placementError((parent?.type as SpaceType | undefined) ?? null, type);
    if (problem) throw new DomainError('SPACE_INVALID_PARENT', problem, 422);
    if ((parent?.depth ?? 0) + 1 + subtreeExtraDepth > MAX_TREE_DEPTH) {
      throw new DomainError(
        'SPACE_TOO_DEEP',
        `The tree can be at most ${MAX_TREE_DEPTH} levels deep`,
        422,
      );
    }
  }

  private assertUnitFields(
    type: SpaceType,
    input: { unitType?: unknown; bedrooms?: unknown; status?: unknown },
  ): void {
    if (
      type !== 'unit' &&
      (input.unitType !== undefined || input.bedrooms !== undefined || input.status !== undefined)
    ) {
      throw new DomainError(
        'UNIT_FIELDS_ON_NON_UNIT',
        'Unit type, bedrooms and status apply to units only',
        422,
      );
    }
  }

  private async liveParent(tx: Tx, estateId: string, parentId: string): Promise<SpaceRow> {
    const parent = await this.load(tx, estateId, parentId);
    if (parent.archivedAt)
      throw new ConflictError('SPACE_ARCHIVED', 'The parent space is archived');
    return parent;
  }

  private async load(tx: Tx, estateId: string, spaceId: string): Promise<SpaceRow> {
    const row = await tx.space.findFirst({ where: { id: spaceId, estateId } });
    if (!row) throw new NotFoundError('Space not found', 'SPACE_NOT_FOUND');
    return row;
  }

  private async estateCode(context: TenantContext): Promise<string> {
    return (await this.tenancy.getProfile(context)).code;
  }

  private cursor(value: string | undefined) {
    return value
      ? decodeCursor(
          value,
          (candidate): candidate is z.infer<typeof cursorSchema> =>
            cursorSchema.safeParse(candidate).success,
        )
      : undefined;
  }

  private page(rows: SpaceRow[], limit: number, estateCode: string) {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.view(row, estateCode)),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ code: last.code, id: last.id }) : null,
    };
  }

  private view(row: SpaceRow, estateCode: string): SpaceView {
    return {
      id: row.id,
      parentId: row.parentId,
      type: row.type as SpaceView['type'],
      code: row.code,
      name: row.name,
      depth: row.depth,
      propertyId: row.type === 'unit' ? propertyIdentifier(estateCode, row.code) : null,
      unitType: row.unitType as SpaceView['unitType'],
      bedrooms: row.bedrooms,
      sizeSqm: row.sizeSqm,
      status: row.status as SpaceView['status'],
      externalRef: row.externalRef,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      version: row.version,
    };
  }
}
