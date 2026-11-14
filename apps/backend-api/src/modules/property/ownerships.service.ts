import { Injectable } from '@nestjs/common';
import type {
  createOwnershipSchema,
  createOwnershipTransferSchema,
  endOwnershipSchema,
  ownerInputSchema,
  transferDecisionSchema,
  transferListQuerySchema,
} from '@safezone/schemas';
import { RESIDENT_ROLE_KEYS } from '@safezone/permissions';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { AuthzService } from '../authz/authz.service';
import { IdentityService } from '../identity/identity.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { PropertyService } from './property.service';

type OwnershipRow = Prisma.OwnershipGetPayload<object>;
type TransferRow = Prisma.OwnershipTransferGetPayload<object>;
type OwnerInput = z.infer<typeof ownerInputSchema>;
interface StoredOwner {
  owner: OwnerInput;
  shareBasisPoints: number;
}

const FULL_SHARE = 10_000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function isStaff(access: EstateAccess, permission: string): boolean {
  return (
    access.permissions.has(permission) &&
    access.roles.some((role) => !RESIDENT_ROLE_KEYS.includes(role))
  );
}

/**
 * Ownership records and transfers (property.md §2.5–2.7, §5.2). History is never edited: a transfer ends the
 * current ownerships and creates new ones. Active shares per unit never exceed 100% (checked at commit).
 */
@Injectable()
export class OwnershipsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly identity: IdentityService,
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
  ) {}

  /** Staff with space.manage or resident.read see all owners of a unit; an owner sees their unit's. */
  async list(access: EstateAccess, spaceId: string) {
    return this.db.withTenant(access, async (tx) => {
      const unit = await this.property.unit(tx, access.estateId, spaceId);
      if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      if (!isStaff(access, 'space.manage') && !isStaff(access, 'resident.read')) {
        const mine = await tx.ownership.count({
          where: {
            estateId: access.estateId,
            spaceId,
            ownerUserId: access.userId,
            status: 'active',
          },
        });
        if (mine === 0) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      }
      const rows = await tx.ownership.findMany({
        where: { estateId: access.estateId, spaceId },
        orderBy: [{ status: 'asc' }, { startsOn: 'desc' }],
      });
      return rows.map((row) => this.view(row, unit.code));
    });
  }

  /** A manager records an owner (verified by their attestation, property.md §9.1). */
  async create(
    access: EstateAccess,
    spaceId: string,
    input: z.infer<typeof createOwnershipSchema>,
  ) {
    const ownerUserId = await this.resolveOwner(access, input.owner);
    return this.db.withTenant(access, async (tx) => {
      const unit = await this.property.unit(tx, access.estateId, spaceId);
      if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      await this.assertShareFits(tx, access.estateId, spaceId, input.shareBasisPoints);
      const row = await this.insertOwnership(tx, access, {
        spaceId,
        ownerUserId,
        owner: input.owner,
        shareBp: input.shareBasisPoints,
        startsOn: input.startsOn ?? today(),
        evidenceFileIds: input.evidenceFileIds,
        transferId: null,
      });
      return this.view(row, unit.code);
    });
  }

  async end(access: EstateAccess, ownershipId: string, input: z.infer<typeof endOwnershipSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.ownership.findFirst({
        where: { id: ownershipId, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Ownership not found', 'OWNERSHIP_NOT_FOUND');
      if (row.status !== 'active')
        throw new ConflictError('OWNERSHIP_NOT_ACTIVE', 'This ownership has already ended');
      const ended = await this.endOwnership(tx, access, row, input.endsOn ?? today(), input.reason);
      const [space] = await this.property.spacesByIds(tx, access.estateId, [row.spaceId]);
      return this.view(ended, space?.code ?? '');
    });
  }

  // ---- Transfers -----------------------------------------------------------------------------

  /** A manager or a current owner opens a transfer; an owner opening it counts as seller confirmation. */
  async requestTransfer(
    access: EstateAccess,
    input: z.infer<typeof createOwnershipTransferSchema>,
  ) {
    const total = input.toOwners.reduce((sum, owner) => sum + owner.shareBasisPoints, 0);
    if (total !== FULL_SHARE)
      throw new DomainError(
        'TRANSFER_SHARES_INVALID',
        'The new owners’ shares must add up to 100%',
        422,
      );
    return this.db.withTenant(access, async (tx) => {
      const unit = await this.property.unit(tx, access.estateId, input.spaceId);
      if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      const current = await tx.ownership.findMany({
        where: { estateId: access.estateId, spaceId: input.spaceId, status: 'active' },
      });
      const isOwner = current.some((row) => row.ownerUserId === access.userId);
      if (!isOwner && !isStaff(access, 'space.manage'))
        throw new ForbiddenError('Only the unit’s owner or estate management can start a transfer');
      const open = await tx.ownershipTransfer.count({
        where: {
          estateId: access.estateId,
          spaceId: input.spaceId,
          status: { in: ['requested', 'seller_confirmed'] },
        },
      });
      if (open > 0)
        throw new ConflictError(
          'TRANSFER_ALREADY_OPEN',
          'This unit already has a transfer in progress',
        );
      const row = await tx.ownershipTransfer.create({
        data: {
          estateId: access.estateId,
          spaceId: input.spaceId,
          type: input.type,
          effectiveOn: date(input.effectiveOn),
          fromOwnershipIds: current.map((ownership) => ownership.id),
          toOwners: input.toOwners as unknown as Prisma.InputJsonValue,
          documentFileIds: input.documentFileIds,
          note: input.note ?? null,
          requestedBy: access.userId,
          ...(isOwner || current.length === 0
            ? { status: 'seller_confirmed', sellerConfirmedBy: isOwner ? access.userId : null }
            : {}),
        },
      });
      await this.event(tx, access, row, 'requested');
      return this.transferView(row, unit.code);
    });
  }

  async transfers(access: EstateAccess, query: z.infer<typeof transferListQuerySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const staff = isStaff(access, 'space.manage');
      const owned = staff
        ? []
        : (
            await tx.ownership.findMany({
              where: { estateId: access.estateId, ownerUserId: access.userId },
              select: { spaceId: true },
            })
          ).map((row) => row.spaceId);
      const rows = await tx.ownershipTransfer.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(staff ? {} : { OR: [{ spaceId: { in: owned } }, { requestedBy: access.userId }] }),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const codes = new Map(
        (
          await this.property.spacesByIds(
            tx,
            access.estateId,
            rows.map((row) => row.spaceId),
          )
        ).map((s) => [s.id, s.code]),
      );
      return rows.map((row) => this.transferView(row, codes.get(row.spaceId) ?? ''));
    });
  }

  /** A current owner confirms the sale (seller confirmation). */
  async confirmTransfer(access: EstateAccess, transferId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadTransfer(tx, access, transferId);
      if (row.status !== 'requested')
        throw new ConflictError(
          'TRANSFER_INVALID_TRANSITION',
          'This transfer cannot be confirmed now',
        );
      const seller = await tx.ownership.count({
        where: { id: { in: row.fromOwnershipIds }, ownerUserId: access.userId, status: 'active' },
      });
      if (seller === 0) throw new ForbiddenError('Only a current owner can confirm this transfer');
      const updated = await this.updateTransfer(tx, row, {
        status: 'seller_confirmed',
        sellerConfirmedBy: access.userId,
      });
      await this.event(tx, access, updated, 'confirmed');
      return this.transferView(updated, await this.code(tx, access.estateId, row.spaceId));
    });
  }

  /**
   * Manager approval completes the transfer (property.md §5.2 steps 3–4). Without seller confirmation the
   * manager must override with documents and a reason.
   */
  async approveTransfer(
    access: EstateAccess,
    transferId: string,
    input: z.infer<typeof transferDecisionSchema>,
  ) {
    const pending = await this.db.withTenant(access, (tx) =>
      this.loadTransfer(tx, access, transferId),
    );
    const toOwners = pending.toOwners as unknown as StoredOwner[];
    const userIds: string[] = [];
    for (const owner of toOwners) userIds.push(await this.resolveOwner(access, owner.owner));
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadTransfer(tx, access, transferId);
      if (row.status === 'requested' && !input.override)
        throw new DomainError(
          'TRANSFER_NEEDS_SELLER',
          'The seller has not confirmed. Attach documents and a reason to override.',
          422,
        );
      if (row.status !== 'requested' && row.status !== 'seller_confirmed')
        throw new ConflictError(
          'TRANSFER_INVALID_TRANSITION',
          'This transfer cannot be approved now',
        );
      const effective = row.effectiveOn.toISOString().slice(0, 10);
      const current = await tx.ownership.findMany({
        where: { id: { in: row.fromOwnershipIds }, status: 'active' },
      });
      if (current.length !== row.fromOwnershipIds.length)
        throw new ConflictError(
          'TRANSFER_STALE',
          'The unit’s owners changed after this transfer was opened',
        );
      for (const ownership of current) {
        await this.endOwnership(tx, access, ownership, effective, `Transferred (${row.type})`);
      }
      for (const [index, owner] of toOwners.entries()) {
        await this.insertOwnership(tx, access, {
          spaceId: row.spaceId,
          ownerUserId: userIds[index] as string,
          owner: owner.owner,
          shareBp: owner.shareBasisPoints,
          startsOn: effective,
          evidenceFileIds: [...row.documentFileIds, ...(input.override?.documentFileIds ?? [])],
          transferId: row.id,
        });
      }
      const updated = await this.updateTransfer(tx, row, {
        status: 'completed',
        decidedBy: access.userId,
        decidedAt: new Date(),
        managerOverride: Boolean(input.override),
        overrideReason: input.override?.reason ?? null,
        documentFileIds: [...row.documentFileIds, ...(input.override?.documentFileIds ?? [])],
      });
      await this.event(tx, access, updated, 'completed', input.override?.reason);
      return this.transferView(updated, await this.code(tx, access.estateId, row.spaceId));
    });
  }

  /** Managers or the seller reject; the requester cancels. */
  async closeTransfer(
    access: EstateAccess,
    transferId: string,
    action: 'reject' | 'cancel',
    reason: string,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadTransfer(tx, access, transferId);
      if (row.status !== 'requested' && row.status !== 'seller_confirmed')
        throw new ConflictError('TRANSFER_INVALID_TRANSITION', 'This transfer is already closed');
      if (action === 'cancel' && row.requestedBy !== access.userId)
        throw new ForbiddenError('Only the person who opened this transfer can cancel it');
      if (action === 'reject' && !isStaff(access, 'space.manage')) {
        const seller = await tx.ownership.count({
          where: { id: { in: row.fromOwnershipIds }, ownerUserId: access.userId, status: 'active' },
        });
        if (seller === 0)
          throw new ForbiddenError('Only management or the seller can reject this transfer');
      }
      const updated = await this.updateTransfer(tx, row, {
        status: action === 'reject' ? 'rejected' : 'cancelled',
        decidedBy: access.userId,
        decidedAt: new Date(),
        reason,
      });
      await this.event(tx, access, updated, action === 'reject' ? 'rejected' : 'cancelled', reason);
      return this.transferView(updated, await this.code(tx, access.estateId, row.spaceId));
    });
  }

  // ---- Internals -----------------------------------------------------------------------------

  private async resolveOwner(access: EstateAccess, owner: OwnerInput): Promise<string> {
    return owner.type === 'person'
      ? this.identity.findOrCreateByPhone(owner.phone, owner.fullName, access.userId)
      : this.identity.findOrCreateByPhone(owner.contactPhone, owner.contactName, access.userId);
  }

  private async assertShareFits(tx: Tx, estateId: string, spaceId: string, shareBp: number) {
    const active = await tx.ownership.aggregate({
      where: { estateId, spaceId, status: 'active' },
      _sum: { shareBp: true },
    });
    if ((active._sum.shareBp ?? 0) + shareBp > FULL_SHARE)
      throw new DomainError(
        'OWNERSHIP_SHARES_EXCEEDED',
        'The unit’s ownership shares would be more than 100%. Use a transfer to change owners.',
        422,
      );
  }

  private async insertOwnership(
    tx: Tx,
    access: EstateAccess,
    input: {
      spaceId: string;
      ownerUserId: string;
      owner: OwnerInput;
      shareBp: number;
      startsOn: string;
      evidenceFileIds: readonly string[];
      transferId: string | null;
    },
  ): Promise<OwnershipRow> {
    const existing = await tx.ownership.count({
      where: { spaceId: input.spaceId, ownerUserId: input.ownerUserId, status: 'active' },
    });
    if (existing > 0)
      throw new ConflictError('OWNERSHIP_EXISTS', 'This person already owns part of this unit');
    const row = await tx.ownership.create({
      data: {
        estateId: access.estateId,
        spaceId: input.spaceId,
        ownerType: input.owner.type,
        ownerUserId: input.ownerUserId,
        ownerName: input.owner.type === 'person' ? input.owner.fullName : input.owner.contactName,
        ownerCompanyName: input.owner.type === 'company' ? input.owner.companyName : null,
        shareBp: input.shareBp,
        startsOn: date(input.startsOn),
        evidenceFileIds: [...input.evidenceFileIds],
        transferId: input.transferId,
        verifiedBy: access.userId,
        verifiedAt: new Date(),
        createdBy: access.userId,
      },
    });
    await this.tenancy.ensureActiveMembership(tx, access.estateId, input.ownerUserId);
    await this.authz.assignBuiltInRole(tx, {
      userId: input.ownerUserId,
      roleKey: 'property_owner',
      estateId: access.estateId,
      grantedBy: access.userId,
      reason: 'Recorded as a unit owner',
    });
    await appendOutboxEvents(tx, [
      {
        type: 'property.ownership.created',
        estateId: access.estateId,
        aggregateType: 'ownership',
        aggregateId: row.id,
        payload: {
          ownershipId: row.id,
          spaceId: row.spaceId,
          ownerUserId: row.ownerUserId,
          shareBp: row.shareBp,
        },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: 'property.ownership.create',
          resourceType: 'space',
          resourceId: row.spaceId,
          after: {
            ownershipId: row.id,
            ownerType: row.ownerType,
            shareBp: row.shareBp,
            transferId: row.transferId,
          },
        },
      },
    ]);
    return row;
  }

  private async endOwnership(
    tx: Tx,
    access: EstateAccess,
    row: OwnershipRow,
    endsOn: string,
    reason: string,
  ) {
    const ended = await tx.ownership.update({
      where: { id: row.id },
      data: { status: 'ended', endsOn: date(endsOn), endedAt: new Date(), endReason: reason },
    });
    const remaining = await tx.ownership.count({
      where: { estateId: access.estateId, ownerUserId: row.ownerUserId, status: 'active' },
    });
    if (remaining === 0) {
      await this.authz.revokeBuiltInRole(tx, {
        userId: row.ownerUserId,
        roleKey: 'property_owner',
        estateId: access.estateId,
        revokedBy: access.userId,
      });
    }
    await appendOutboxEvents(tx, [
      {
        type: 'property.ownership.ended',
        estateId: access.estateId,
        aggregateType: 'ownership',
        aggregateId: row.id,
        payload: { ownershipId: row.id, spaceId: row.spaceId, ownerUserId: row.ownerUserId },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: 'property.ownership.end',
          resourceType: 'space',
          resourceId: row.spaceId,
          before: { ownershipId: row.id, shareBp: row.shareBp },
          reason,
        },
      },
    ]);
    return ended;
  }

  private async loadTransfer(
    tx: Tx,
    access: EstateAccess,
    transferId: string,
  ): Promise<TransferRow> {
    const row = await tx.ownershipTransfer.findFirst({
      where: { id: transferId, estateId: access.estateId },
    });
    if (!row) throw new NotFoundError('Transfer not found', 'TRANSFER_NOT_FOUND');
    return row;
  }

  private async updateTransfer(
    tx: Tx,
    row: TransferRow,
    data: Prisma.OwnershipTransferUpdateManyMutationInput,
  ) {
    const result = await tx.ownershipTransfer.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0)
      throw new ConflictError('VERSION_MISMATCH', 'This transfer was changed by someone else');
    return tx.ownershipTransfer.findFirstOrThrow({ where: { id: row.id } });
  }

  private async code(tx: Tx, estateId: string, spaceId: string) {
    const [space] = await this.property.spacesByIds(tx, estateId, [spaceId]);
    return space?.code ?? '';
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    row: TransferRow,
    verb: 'requested' | 'confirmed' | 'completed' | 'rejected' | 'cancelled',
    reason?: string,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `property.transfer.${verb}`,
        estateId: access.estateId,
        aggregateType: 'ownership_transfer',
        aggregateId: row.id,
        payload: { transferId: row.id, spaceId: row.spaceId, status: row.status },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: `property.transfer.${verb}`,
          resourceType: 'space',
          resourceId: row.spaceId,
          after: { transferId: row.id, status: row.status, managerOverride: row.managerOverride },
          ...(reason ? { reason } : {}),
        },
      },
    ]);
  }

  private view(row: OwnershipRow, unitCode: string) {
    return {
      id: row.id,
      spaceId: row.spaceId,
      unitCode,
      ownerType: row.ownerType as 'person' | 'company',
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      companyName: row.ownerCompanyName,
      shareBasisPoints: row.shareBp,
      startsOn: row.startsOn.toISOString().slice(0, 10),
      endsOn: row.endsOn?.toISOString().slice(0, 10) ?? null,
      status: row.status as 'active' | 'ended',
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    };
  }

  private transferView(row: TransferRow, unitCode: string) {
    const owners = row.toOwners as unknown as StoredOwner[];
    return {
      id: row.id,
      spaceId: row.spaceId,
      unitCode,
      type: row.type as 'sale',
      effectiveOn: row.effectiveOn.toISOString().slice(0, 10),
      fromOwnershipIds: row.fromOwnershipIds,
      toOwners: owners.map((item) => ({
        name: item.owner.type === 'person' ? item.owner.fullName : item.owner.contactName,
        companyName: item.owner.type === 'company' ? item.owner.companyName : null,
        shareBasisPoints: item.shareBasisPoints,
      })),
      status: row.status as 'requested',
      requestedBy: row.requestedBy,
      sellerConfirmedBy: row.sellerConfirmedBy,
      managerOverride: row.managerOverride,
      decidedBy: row.decidedBy,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
