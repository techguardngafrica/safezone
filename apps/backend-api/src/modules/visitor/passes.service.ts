import { Injectable } from '@nestjs/common';
import type { createVisitorInvitationSchema, passListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { RateLimiter } from '../../common/rate-limit/rate-limiter';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { normalisePlate } from '../occupancy/domain/occupancy';
import { PropertyService } from '../property/property.service';
import { GatesService } from '../security/gates.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { generatePin } from './domain/pass-token';
import {
  defaultMaxUses,
  type PassFacts,
  passStatus,
  type PassType,
  type Recurrence,
} from './domain/validity';
import { PassKeysService } from './pass-keys.service';

export type PassRow = Prisma.VisitorPassGetPayload<{ include: { invitation: true } }>;

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
const MAX_PIN_ATTEMPTS = 5;
const STAFF_PASS_MAX_DAYS = 366;
const PASS_PAGE_VIEWS_PER_IP_PER_HOUR = 60;

export function passFacts(row: PassRow): PassFacts {
  return {
    type: row.invitation.type as PassType,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recurrence: (row.recurrence as Recurrence | null) ?? null,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    revokedAt: row.revokedAt,
    gateIds: row.gateIds,
  };
}

export function toPassView(row: PassRow) {
  return {
    id: row.id,
    invitationId: row.invitationId,
    type: row.invitation.type as PassType,
    status: passStatus(passFacts(row)),
    visitorName: row.visitorName,
    visitorPhone: row.visitorPhone,
    vehiclePlate: row.vehiclePlate,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    recurrence: (row.recurrence as Recurrence | null) ?? null,
    gateIds: row.gateIds,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    hostHouseholdId: row.invitation.hostHouseholdId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Visitor invitations and passes (visitor.md §2–§8), host side and the public pass page. */
@Injectable()
export class PassesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly keys: PassKeysService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly gates: GatesService,
    private readonly tenancy: TenancyService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Creates an invitation with one pass per visitor (visitor.md §7.1–§7.2). Residents need the household's
   * inviteVisitors permission; management can create estate passes without a household.
   */
  async create(access: EstateAccess, input: z.infer<typeof createVisitorInvitationSchema>) {
    const settings = await this.tenancy.getSettings(access);
    const validFrom = new Date(input.validFrom);
    const validTo = new Date(input.validTo);
    const maxDays =
      input.type === 'domestic_staff' ? STAFF_PASS_MAX_DAYS : settings['visitor.max_pass_days'];
    if (validTo.getTime() - validFrom.getTime() > maxDays * 86_400_000) {
      throw new DomainError('PASS_TOO_LONG', `Passes can last at most ${maxDays} days`, 422);
    }
    if (validTo <= new Date())
      throw new DomainError('PASS_IN_PAST', 'The pass would already have ended', 422);

    const created = await this.db.withTenant(access, async (tx) => {
      const host = await this.hostOf(tx, access, input.householdId);
      for (const gateId of input.gateIds) await this.gates.activeGate(tx, access.estateId, gateId);

      let recurrence: Recurrence | null = input.recurrence ?? null;
      if (input.type === 'domestic_staff') {
        const staff = input.domesticStaffId
          ? await this.occupancy.activeStaff(tx, access.estateId, input.domesticStaffId)
          : null;
        if (!staff || staff.householdId !== input.householdId) {
          throw new DomainError(
            'STAFF_NOT_ACTIVE',
            'Only approved staff of this household get staff passes',
            422,
          );
        }
        recurrence = staff.schedule as unknown as Recurrence;
      }
      const { keyIndex } = await this.keys.currentKey(tx, access.estateId);
      const invitation = await tx.visitorInvitation.create({
        data: {
          estateId: access.estateId,
          hostUserId: access.userId,
          hostHouseholdId: host?.householdId ?? null,
          spaceId: host?.spaceId ?? null,
          type: input.type,
          purpose: input.purpose ?? null,
          createdBy: access.userId,
        },
      });
      const passIds: string[] = [];
      // An event is one pass for the whole event plus its guest list (visitor.md §3).
      const people = input.event ? [{ name: input.event.name }] : input.visitors;
      for (const visitor of people as { name: string; phone?: string; vehiclePlate?: string }[]) {
        const id = uuidv7();
        await this.insertWithUniquePin(tx, {
          id,
          estateId: access.estateId,
          invitationId: invitation.id,
          visitorName: visitor.name,
          visitorPhone: visitor.phone ?? null,
          vehiclePlate: visitor.vehiclePlate ? normalisePlate(visitor.vehiclePlate) : null,
          publicTokenHash: PassKeysService.hashPublicToken(
            this.keys.publicToken(access.estateId, id),
          ),
          validFrom,
          validTo,
          recurrence: recurrence ? ({ ...recurrence } as Prisma.InputJsonObject) : undefined,
          gateIds: input.gateIds,
          maxUses: defaultMaxUses(input.type, input.maxUses),
          domesticStaffId: input.domesticStaffId ?? null,
          keyIndex,
        });
        passIds.push(id);
      }
      const [eventPassId] = passIds;
      if (input.event && eventPassId) {
        await tx.eventGuest.createMany({
          data: input.event.guests.map((name) => ({
            estateId: access.estateId,
            passId: eventPassId,
            name,
          })),
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.pass.created',
          estateId: access.estateId,
          aggregateType: 'visitor_invitation',
          aggregateId: invitation.id,
          payload: { invitationId: invitation.id, passIds, type: input.type },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'visitor.pass.create',
            resourceType: 'visitor_invitation',
            resourceId: invitation.id,
            after: {
              type: input.type,
              passes: passIds.length,
              ...(input.event ? { guests: input.event.guests.length } : {}),
              validFrom: input.validFrom,
              validTo: input.validTo,
            },
          },
        },
      ]);
      return Promise.all(passIds.map((id) => this.withCredentials(tx, access.estateId, id)));
    });
    return created;
  }

  async list(access: EstateAccess, query: z.infer<typeof passListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    if (!query.mine && !isStaffWith(access, 'visitor.log.read')) throw new ForbiddenError();
    const households = query.mine
      ? (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
          (h) => h.householdId,
        )
      : [];
    const now = new Date();
    const statusWhere: Prisma.VisitorPassWhereInput =
      query.status === 'revoked'
        ? { revokedAt: { not: null } }
        : query.status === 'expired'
          ? { revokedAt: null, validTo: { lt: now } }
          : query.status === 'scheduled'
            ? { revokedAt: null, validFrom: { gt: now } }
            : query.status === 'active' || query.status === 'used'
              ? { revokedAt: null, validFrom: { lte: now }, validTo: { gte: now } }
              : {};
    const rows = await this.db.withTenant(access, (tx) =>
      tx.visitorPass.findMany({
        where: {
          estateId: access.estateId,
          ...statusWhere,
          ...(query.mine
            ? {
                invitation: {
                  OR: [{ hostHouseholdId: { in: households } }, { hostUserId: access.userId }],
                },
              }
            : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: { invitation: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    // used vs active share a time window; filter precisely after loading.
    const filtered = query.status
      ? rows.filter((row) => passStatus(passFacts(row)) === query.status)
      : rows;
    const page = filtered.slice(0, query.limit);
    const last = rows.length > query.limit ? rows[query.limit - 1] : undefined;
    return {
      items: page.map(toPassView),
      nextCursor: last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
    };
  }

  /** Pass with credentials, for its host household or management. */
  async get(access: EstateAccess, passId: string) {
    return this.db.withTenant(access, async (tx) => {
      await this.manageablePass(tx, access, passId, false);
      return this.withCredentials(tx, access.estateId, passId);
    });
  }

  async revoke(access: EstateAccess, passId: string, reason: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.manageablePass(tx, access, passId, true);
      if (row.revokedAt) throw new ConflictError('PASS_REVOKED', 'This pass is already revoked');
      const updated = await tx.visitorPass.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), revokedBy: access.userId, revocationReason: reason },
        include: { invitation: true },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.pass.revoked',
          estateId: access.estateId,
          aggregateType: 'visitor_pass',
          aggregateId: row.id,
          payload: { passId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'visitor.pass.revoke',
            resourceType: 'visitor_pass',
            resourceId: row.id,
            reason,
          },
        },
      ]);
      return toPassView(updated);
    });
  }

  /** Sends the pass link and PIN to the visitor by SMS (worker, `gate` queue). */
  async share(access: EstateAccess, passId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.manageablePass(tx, access, passId, true);
      if (!row.visitorPhone)
        throw new DomainError('NO_VISITOR_PHONE', 'Add the visitor phone number first', 422);
      const status = passStatus(passFacts(row));
      if (status !== 'active' && status !== 'scheduled') {
        throw new ConflictError('PASS_NOT_USABLE', 'Only scheduled or active passes can be shared');
      }
      const shareId = uuidv7();
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.pass.shared',
          estateId: access.estateId,
          aggregateType: 'visitor_pass',
          aggregateId: row.id,
          payload: { passId: row.id, shareId, hostUserId: access.userId },
        },
      ]);
      return { queued: true as const };
    });
  }

  /** Public pass page data (visitor.md §8). The token carries its estate; nothing else is revealed. */
  async publicPass(token: string, ip: string | undefined) {
    if (ip) {
      const limit = await this.rateLimiter.hit(
        `passpage:ip:${ip}`,
        PASS_PAGE_VIEWS_PER_IP_PER_HOUR,
        3600,
      );
      if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    }
    const estateId = PassKeysService.estateOfPublicToken(token);
    if (!estateId) throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
    const estate = await this.tenancy.getProfile({ estateId, userId: null }).catch(() => null);
    if (!estate) throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const row = await tx.visitorPass.findFirst({
        where: { estateId, publicTokenHash: PassKeysService.hashPublicToken(token) },
        include: { invitation: true },
      });
      if (!row) throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
      const status = passStatus(passFacts(row));
      const usable = status === 'active' || status === 'scheduled';
      const [unit] = row.invitation.spaceId
        ? await this.property.spacesByIds(tx, estateId, [row.invitation.spaceId])
        : [];
      return {
        estateName: estate.name,
        visitorName: row.visitorName,
        unitCode: unit?.code ?? null,
        status,
        validFrom: row.validFrom.toISOString(),
        validTo: row.validTo.toISOString(),
        recurrence: (row.recurrence as Recurrence | null) ?? null,
        pin: usable ? this.keys.unwrapPin(row.pinWrapped) : null,
        qr: usable ? await this.qrFor(tx, row) : null,
      };
    });
  }

  // ---- Internals -----------------------------------------------------------------------------

  async qrFor(tx: Tx, row: PassRow): Promise<string> {
    return this.keys.sign(tx, {
      passId: row.id,
      estateId: row.estateId,
      notBefore: row.validFrom,
      notAfter: row.validTo,
      maxUses: row.maxUses ?? 0,
      keyIndex: row.keyIndex,
    });
  }

  private async withCredentials(tx: Tx, estateId: string, passId: string) {
    const row = await tx.visitorPass.findFirstOrThrow({
      where: { id: passId, estateId },
      include: { invitation: true },
    });
    return {
      ...toPassView(row),
      pin: this.keys.unwrapPin(row.pinWrapped),
      qr: await this.qrFor(tx, row),
      passUrl: this.keys.passUrl(estateId, row.id),
    };
  }

  /**
   * Picks a PIN no live pass in the estate uses. Expired and revoked passes free their PIN. A concurrent
   * clash is possible but rare; verification then answers CHECK (`ambiguous_pin`), never ALLOW.
   */
  private async insertWithUniquePin(
    tx: Tx,
    data: Omit<Prisma.VisitorPassUncheckedCreateInput, 'pinLookup' | 'pinWrapped'>,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      const pin = generatePin();
      const lookup = this.keys.pinLookup(data.estateId, pin);
      const clash = await tx.visitorPass.count({
        where: {
          estateId: data.estateId,
          pinLookup: lookup,
          revokedAt: null,
          validTo: { gte: new Date() },
        },
      });
      if (clash > 0) continue;
      await tx.visitorPass.create({
        data: { ...data, pinLookup: lookup, pinWrapped: this.keys.wrapPin(pin) },
      });
      return;
    }
    throw new DomainError('PIN_SPACE_EXHAUSTED', 'Could not issue a PIN. Try again.', 503);
  }

  /** The host household for a new pass, after the permission check (visitor.md §7.1). */
  private async hostOf(tx: Tx, access: EstateAccess, householdId: string | undefined) {
    const management = isStaffWith(access, 'visitor.log.read');
    if (!householdId) {
      if (!management)
        throw new DomainError(
          'HOUSEHOLD_REQUIRED',
          'Choose the household the visitor is coming to',
          422,
        );
      return null;
    }
    const permissions = await this.occupancy.memberPermissions(
      tx,
      access.estateId,
      householdId,
      access.userId,
    );
    if (!permissions && !management)
      throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    if (permissions && !permissions.inviteVisitors && !management) {
      throw new ForbiddenError(
        'Your household has not allowed you to invite visitors',
        'VISITOR_INVITE_NOT_ALLOWED',
      );
    }
    if (!management && !access.permissions.has('visitor.invite')) throw new ForbiddenError();
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    const mine = households.find((household) => household.householdId === householdId);
    if (mine) return { householdId, spaceId: mine.spaceId };
    // Management issuing a pass for a household they do not live in.
    const spaceId = await this.occupancy.activeHouseholdUnit(tx, access.estateId, householdId);
    if (!spaceId) throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    return { householdId, spaceId };
  }

  /** Host household members (with inviteVisitors when changing it) or management. Others get 404. */
  private async manageablePass(
    tx: Tx,
    access: EstateAccess,
    passId: string,
    write: boolean,
  ): Promise<PassRow> {
    const row = await tx.visitorPass.findFirst({
      where: { id: passId, estateId: access.estateId },
      include: { invitation: true },
    });
    if (!row) throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
    if (isStaffWith(access, 'visitor.log.read') || row.invitation.hostUserId === access.userId)
      return row;
    if (row.invitation.hostHouseholdId) {
      const permissions = await this.occupancy.memberPermissions(
        tx,
        access.estateId,
        row.invitation.hostHouseholdId,
        access.userId,
      );
      if (permissions && (!write || permissions.inviteVisitors)) return row;
    }
    throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
  }
}
