import { Inject, Injectable } from '@nestjs/common';
import { maskPhone } from '@safezone/auth';
import type {
  createEstateSchema,
  createInvitationSchema,
  leadListQuerySchema,
  OnboardingLead,
  platformEstateListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../../common/database/database.service';
import type { Tx } from '../../../common/database/tenant-context';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from '../../../common/errors/domain-error';
import { uuidv7 } from '../../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { RateLimiter } from '../../../common/rate-limit/rate-limiter';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { AuthzService } from '../../authz/authz.service';
import { IdentityService } from '../../identity/identity.service';
import { generateEstateCode, generateEstateSlug } from '../domain/codes';
import { type EstateAction, nextEstateStatus } from '../domain/estate-lifecycle';
import {
  deriveInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_MS,
  invitationStatus,
} from '../domain/invitation-token';

type EstateRow = Prisma.EstateGetPayload<object>;
type InvitationRow = Prisma.EstateInvitationGetPayload<object>;

const estateCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
const leadCursorSchema = estateCursorSchema;

/** Public lead form: per IP per hour (AGENTS.md §6.1, rate-limit public APIs). */
const LEADS_PER_IP_PER_HOUR = 5;
const INVITATION_PREVIEWS_PER_IP_PER_HOUR = 30;

export function toPlatformEstate(row: EstateRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    code: row.code,
    type: row.type as 'gated_houses' | 'apartment_complex' | 'mixed',
    address: row.address,
    state: row.state,
    lga: row.lga,
    timezone: row.timezone,
    currency: 'NGN' as const,
    status: row.status as
      | 'applied'
      | 'under_review'
      | 'info_requested'
      | 'approved'
      | 'active'
      | 'suspended'
      | 'deactivated'
      | 'rejected',
    onboardingMode: row.onboardingMode as 'self_service' | 'assisted',
    version: row.version,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInvitationView(row: InvitationRow) {
  return {
    id: row.id,
    estateId: row.estateId,
    phone: maskPhone(row.phone),
    email: row.email,
    roleKey: row.roleKey,
    status: invitationStatus(row),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Techguard-assisted onboarding and the estate lifecycle (tenancy.md §4.2, §7.5–7.6): leads, creating an
 * estate for a customer, inviting its representative, suspension, reactivation and deactivation.
 */
@Injectable()
export class EstatesAdminService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly authz: AuthzService,
    private readonly identity: IdentityService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  // ---- Leads ---------------------------------------------------------------------------------

  async createLead(input: OnboardingLead, ip: string | undefined): Promise<{ id: string }> {
    if (ip) {
      const limit = await this.rateLimiter.hit(`leads:ip:${ip}`, LEADS_PER_IP_PER_HOUR, 3600);
      if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    }
    return this.db.withContext('tenancy', async (tx) => {
      const id = uuidv7();
      await tx.onboardingLead.create({
        data: {
          id,
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          estateName: input.estateName,
          location: input.location,
          unitsEstimate: input.unitsEstimate ?? null,
          message: input.message ?? null,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'tenancy.lead.created',
          estateId: null,
          aggregateType: 'onboarding_lead',
          aggregateId: id,
          payload: { leadId: id },
        },
      ]);
      return { id };
    });
  }

  async listLeads(query: z.infer<typeof leadListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof leadCursorSchema> =>
            leadCursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.onboardingLead.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        estateName: row.estateName,
        location: row.location,
        unitsEstimate: row.unitsEstimate,
        message: row.message,
        status: row.status as 'new' | 'contacted' | 'converted' | 'closed',
        estateId: row.estateId,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async updateLead(
    staffId: string,
    leadId: string,
    status: 'new' | 'contacted' | 'converted' | 'closed',
  ) {
    return this.db.withContext('tenancy', async (tx) => {
      const lead = await tx.onboardingLead.findUnique({ where: { id: leadId } });
      if (!lead) throw new NotFoundError('Lead not found', 'LEAD_NOT_FOUND');
      await tx.onboardingLead.update({
        where: { id: leadId },
        data: { status, ownerUserId: lead.ownerUserId ?? staffId },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'tenancy.lead.updated',
          estateId: null,
          aggregateType: 'onboarding_lead',
          aggregateId: leadId,
          payload: { leadId, status },
          audit: {
            actorType: 'platform_staff',
            actorId: staffId,
            action: 'tenancy.lead.update',
            resourceType: 'onboarding_lead',
            resourceId: leadId,
            before: { status: lead.status },
            after: { status },
          },
        },
      ]);
      return { id: leadId, status };
    });
  }

  // ---- Estates -------------------------------------------------------------------------------

  /** Assisted onboarding step 2: Techguard creates the estate (status approved, free core plan). */
  async createEstate(staffId: string, input: z.infer<typeof createEstateSchema>) {
    for (let attempt = 0; ; attempt += 1) {
      const estateId = uuidv7();
      try {
        return await this.db.withContext(
          'tenancy',
          async (tx) => {
            if (input.leadId) {
              const lead = await tx.onboardingLead.findUnique({ where: { id: input.leadId } });
              if (!lead) throw new NotFoundError('Lead not found', 'LEAD_NOT_FOUND');
              if (lead.estateId) {
                throw new ConflictError(
                  'LEAD_ALREADY_CONVERTED',
                  'This lead already has an estate',
                );
              }
            }
            const now = new Date();
            const estate = await tx.estate.create({
              data: {
                id: estateId,
                name: input.name,
                slug: generateEstateSlug(input.name),
                code: generateEstateCode(),
                type: input.type,
                address: input.address,
                state: input.state,
                lga: input.lga,
                status: 'approved',
                onboardingMode: 'assisted',
                approvedBy: staffId,
                approvedAt: now,
              },
            });
            if (input.leadId) {
              await tx.onboardingLead.update({
                where: { id: input.leadId },
                data: { status: 'converted', estateId, ownerUserId: staffId },
              });
            }
            await appendOutboxEvents(tx, [
              {
                type: 'tenancy.estate.created',
                estateId,
                aggregateType: 'estate',
                aggregateId: estateId,
                payload: { estateId, onboardingMode: 'assisted', leadId: input.leadId ?? null },
                audit: {
                  actorType: 'platform_staff',
                  actorId: staffId,
                  action: 'tenancy.estate.create',
                  resourceType: 'estate',
                  resourceId: estateId,
                  after: { name: input.name, onboardingMode: 'assisted' },
                },
              },
            ]);
            return toPlatformEstate(estate);
          },
          { estateId, userId: staffId },
        );
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 4) continue;
        throw error;
      }
    }
  }

  async listEstates(query: z.infer<typeof platformEstateListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof estateCursorSchema> =>
            estateCursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.estate.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { code: { equals: query.q.toUpperCase() } },
                ],
              }
            : {}),
          ...(after
            ? {
                AND: [
                  {
                    OR: [
                      { createdAt: { lt: new Date(after.createdAt) } },
                      { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toPlatformEstate),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async getEstate(estateId: string) {
    const row = await this.db.withContext('tenancy', (tx) =>
      tx.estate.findUnique({ where: { id: estateId } }),
    );
    if (!row) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    return toPlatformEstate(row);
  }

  /**
   * Suspension keeps safety features working (visitor verification, SOS, safety records): only
   * management changes are blocked, by the authorization guard (tenancy.md §7.5).
   */
  async changeLifecycle(
    staffId: string,
    estateId: string,
    action: Exclude<EstateAction, 'activate'>,
    reason: string,
  ) {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const estate = await tx.estate.findUnique({ where: { id: estateId } });
        if (!estate) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
        const next = nextEstateStatus(estate.status, action, estate.activatedAt !== null);
        if (!next) {
          throw new ConflictError(
            'ESTATE_INVALID_STATE',
            `This estate is ${estate.status} and cannot be changed that way`,
          );
        }
        const data: Prisma.EstateUpdateManyMutationInput = {
          status: next,
          version: { increment: 1 },
        };
        if (action === 'suspend') {
          data.suspendedAt = new Date();
          data.suspensionReason = reason;
        } else if (action === 'reactivate') {
          data.suspendedAt = null;
          data.suspensionReason = null;
        }
        const updated = await tx.estate.updateMany({
          where: { id: estateId, status: estate.status, version: estate.version },
          data,
        });
        if (updated.count === 0) {
          throw new ConflictError(
            'VERSION_MISMATCH',
            'This estate was changed by someone else. Reload and try again.',
          );
        }
        const past = { suspend: 'suspended', reactivate: 'reactivated', deactivate: 'deactivated' }[
          action
        ];
        await appendOutboxEvents(tx, [
          {
            type: `tenancy.estate.${past}`,
            estateId,
            aggregateType: 'estate',
            aggregateId: estateId,
            payload: { estateId, status: next },
            audit: {
              actorType: 'platform_staff',
              actorId: staffId,
              action: `tenancy.estate.${action}`,
              resourceType: 'estate',
              resourceId: estateId,
              before: { status: estate.status },
              after: { status: next },
              reason,
            },
          },
        ]);
        return toPlatformEstate(await tx.estate.findUniqueOrThrow({ where: { id: estateId } }));
      },
      { estateId, userId: staffId },
    );
  }

  // ---- Invitations ---------------------------------------------------------------------------

  /**
   * Invites a representative (assisted step 4). Replaces any pending invitation for the same phone. The
   * link is sent by the worker (onboarding queue), which derives the token again; it is never stored.
   */
  async createInvitation(
    staffId: string,
    estateId: string,
    input: z.infer<typeof createInvitationSchema>,
  ) {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const estate = await tx.estate.findUnique({ where: { id: estateId } });
        if (!estate) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
        if (estate.status === 'deactivated' || estate.status === 'rejected') {
          throw new ConflictError(
            'ESTATE_INVALID_STATE',
            'This estate can no longer accept invitations',
          );
        }
        const now = new Date();
        await tx.estateInvitation.updateMany({
          where: { estateId, phone: input.phone, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        const id = uuidv7();
        const token = deriveInvitationToken(this.env.OTP_HMAC_SECRET, id);
        const row = await tx.estateInvitation.create({
          data: {
            id,
            estateId,
            phone: input.phone,
            email: input.email ?? null,
            roleKey: input.roleKey,
            tokenHash: hashInvitationToken(token),
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
            invitedBy: staffId,
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'tenancy.invitation.sent',
            estateId,
            aggregateType: 'estate_invitation',
            aggregateId: id,
            payload: { invitationId: id },
            audit: {
              actorType: 'platform_staff',
              actorId: staffId,
              action: 'tenancy.invitation.create',
              resourceType: 'estate_invitation',
              resourceId: id,
              after: { roleKey: input.roleKey, phone: maskPhone(input.phone) },
            },
          },
        ]);
        return toInvitationView(row);
      },
      { estateId, userId: staffId },
    );
  }

  async listInvitations(estateId: string) {
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.estateInvitation.findMany({
        where: { estateId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map(toInvitationView);
  }

  async revokeInvitation(staffId: string, estateId: string, invitationId: string) {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const row = await tx.estateInvitation.findFirst({ where: { id: invitationId, estateId } });
        if (!row) throw new NotFoundError('Invitation not found', 'INVITATION_NOT_FOUND');
        if (invitationStatus(row) !== 'pending') {
          throw new ConflictError('INVITATION_NOT_PENDING', 'This invitation is no longer pending');
        }
        const updated = await tx.estateInvitation.update({
          where: { id: invitationId },
          data: { revokedAt: new Date() },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'tenancy.invitation.revoked',
            estateId,
            aggregateType: 'estate_invitation',
            aggregateId: invitationId,
            payload: { invitationId },
            audit: {
              actorType: 'platform_staff',
              actorId: staffId,
              action: 'tenancy.invitation.revoke',
              resourceType: 'estate_invitation',
              resourceId: invitationId,
            },
          },
        ]);
        return toInvitationView(updated);
      },
      { estateId, userId: staffId },
    );
  }

  /** Public preview for the invitation page. Unknown tokens get 404; the phone is masked. */
  async previewInvitation(token: string, ip: string | undefined) {
    if (ip) {
      const limit = await this.rateLimiter.hit(
        `invitations:preview:ip:${ip}`,
        INVITATION_PREVIEWS_PER_IP_PER_HOUR,
        3600,
      );
      if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    }
    return this.db.withContext('tenancy', async (tx) => {
      const row = await this.findByToken(tx, token);
      const estate = await tx.estate.findUniqueOrThrow({
        where: { id: row.estateId },
        select: { name: true },
      });
      return {
        estateName: estate.name,
        roleKey: row.roleKey,
        phoneMasked: maskPhone(row.phone),
        expiresAt: row.expiresAt.toISOString(),
        status: invitationStatus(row),
      };
    });
  }

  /**
   * Accepting (assisted step 5): the signed-in user's verified phone must be the invited one. Grants the
   * membership and role in one transaction. Staff roles then require MFA enrolment on the next request.
   */
  async acceptInvitation(userId: string, token: string) {
    const contacts = await this.identity.contactsOf([userId]);
    const phone = contacts.get(userId)?.phone;
    const { estateId } = await this.db.withContext('tenancy', (tx) => this.findByToken(tx, token));
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const row = await this.findByToken(tx, token);
        const status = invitationStatus(row);
        if (status !== 'pending') {
          throw new ConflictError(
            status === 'expired' ? 'INVITATION_EXPIRED' : 'INVITATION_NOT_PENDING',
            status === 'expired'
              ? 'This invitation has expired. Ask Techguard to send a new one.'
              : 'This invitation can no longer be used',
          );
        }
        if (!phone || phone !== row.phone) {
          throw new ForbiddenError(
            'Sign in with the phone number this invitation was sent to',
            'INVITATION_PHONE_MISMATCH',
          );
        }
        const estate = await tx.estate.findUniqueOrThrow({ where: { id: row.estateId } });
        if (estate.status === 'deactivated' || estate.status === 'rejected') {
          throw new ConflictError('ESTATE_INVALID_STATE', 'This estate is no longer on Safezone');
        }
        const claimed = await tx.estateInvitation.updateMany({
          where: { id: row.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date(), acceptedBy: userId },
        });
        if (claimed.count === 0) {
          throw new ConflictError(
            'INVITATION_NOT_PENDING',
            'This invitation can no longer be used',
          );
        }
        await tx.estateMembership.upsert({
          where: { estateId_userId: { estateId: row.estateId, userId } },
          create: { estateId: row.estateId, userId, status: 'active' },
          update: { status: 'active', leftAt: null },
        });
        await this.authz.assignBuiltInRole(tx, {
          userId,
          roleKey: row.roleKey,
          estateId: row.estateId,
          grantedBy: row.invitedBy,
          reason: `estate invitation ${row.id} accepted`,
        });
        await appendOutboxEvents(tx, [
          {
            type: 'tenancy.invitation.accepted',
            estateId: row.estateId,
            aggregateType: 'estate_invitation',
            aggregateId: row.id,
            payload: { invitationId: row.id, userId },
            audit: {
              actorType: 'user',
              actorId: userId,
              action: 'tenancy.invitation.accept',
              resourceType: 'estate_invitation',
              resourceId: row.id,
              after: { roleKey: row.roleKey },
            },
          },
        ]);
        return { estateId: row.estateId, roleKey: row.roleKey };
      },
      { userId, estateId },
    );
  }

  private async findByToken(tx: Tx, token: string): Promise<InvitationRow> {
    const row = await tx.estateInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
    });
    if (!row) throw new NotFoundError('Invitation not found', 'INVITATION_NOT_FOUND');
    return row;
  }
}
