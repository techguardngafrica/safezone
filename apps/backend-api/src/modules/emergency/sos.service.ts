import { Injectable } from '@nestjs/common';
import type { sosListQuerySchema, triggerSosSchema } from '@safezone/schemas';
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
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { ACTIVE_SOS_STATUSES, isActiveSos, nextSosStatus, type SosAction } from './domain/sos';

type AlertRow = Prisma.SosAlertGetPayload<object>;
const BROADCAST_CHUNK = 5000;
const SOS_EVENT_FOR_ACTION: Record<SosAction, string> = {
  cancel: 'cancelled',
  acknowledge: 'acknowledged',
  assign: 'assigned',
  responding: 'responding',
  resolve: 'resolved',
  close: 'closed',
};

export const RESPONDER_ROLES = ['security_officer', 'security_supervisor'] as const;
export const MANAGER_ROLES = ['estate_owner', 'estate_administrator', 'estate_manager'] as const;

/**
 * SOS (emergency.md). The request path does the minimum: validate, write the alert, its first timeline
 * event and the outbox row in one transaction, then return. Fan-out and escalation run on the dedicated
 * `sos` queue (SosConsumer), never on shared queues.
 */
@Injectable()
export class SosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  async trigger(access: EstateAccess, clientUuid: string, input: z.infer<typeof triggerSosSchema>) {
    const responder = access.permissions.has('sos.respond');
    if (input.isDrill && !isStaffWith(access, 'sos.respond')) {
      throw new ForbiddenError(
        'Only security supervisors and managers can start drills',
        'DRILL_NOT_ALLOWED',
      );
    }
    // Residents raise SOS for their household; they need the household's triggerSos permission.
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    const household = input.householdId
      ? households.find((item) => item.householdId === input.householdId)
      : households[0];
    if (input.householdId && !household && !responder) {
      throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    }
    if (!responder && household && !household.permissions.triggerSos) {
      throw new ForbiddenError(
        'Your household has not allowed you to raise SOS',
        'SOS_NOT_ALLOWED',
      );
    }
    const triggerRole = access.permissions.has('gate.verify')
      ? 'guard'
      : household
        ? 'resident'
        : 'staff';

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.db.withTenant(access, async (tx) => {
          const replay = await tx.sosAlert.findUnique({
            where: { estateId_clientUuid: { estateId: access.estateId, clientUuid } },
          });
          if (replay) return this.view(tx, replay, true);

          const active =
            household && !input.isDrill
              ? await tx.sosAlert.findFirst({
                  where: {
                    estateId: access.estateId,
                    householdId: household.householdId,
                    isDrill: false,
                    status: { in: [...ACTIVE_SOS_STATUSES] },
                  },
                })
              : null;
          if (active) {
            await this.event(tx, active, 'retriggered', access.userId, {
              category: input.category,
            });
            if (input.location) await this.saveLocation(tx, active, input.location);
            return this.view(tx, active, true);
          }

          const alert = await tx.sosAlert.create({
            data: {
              estateId: access.estateId,
              triggeredBy: access.userId,
              triggerRole,
              householdId: household?.householdId ?? null,
              spaceId: household?.spaceId ?? null,
              category: input.category,
              isDrill: input.isDrill,
              clientUuid,
            },
          });
          await this.event(tx, alert, 'triggered', access.userId, {
            category: input.category,
            drill: input.isDrill,
          });
          if (input.location) await this.saveLocation(tx, alert, input.location);
          await appendOutboxEvents(tx, [
            {
              type: 'emergency.alert.triggered',
              estateId: access.estateId,
              aggregateType: 'sos_alert',
              aggregateId: alert.id,
              payload: { alertId: alert.id, isDrill: input.isDrill },
              audit: {
                actorType: 'user',
                actorId: access.userId,
                action: 'emergency.alert.trigger',
                resourceType: 'sos_alert',
                resourceId: alert.id,
                after: { category: input.category, drill: input.isDrill },
              },
            },
          ]);
          return this.view(tx, alert, false);
        });
      } catch (error) {
        // Two triggers for one household at once: the second attaches to the first.
        if ((error as { code?: unknown }).code === 'P2002' && attempt < 2) continue;
        throw error;
      }
    }
  }

  async list(access: EstateAccess, query: z.infer<typeof sosListQuerySchema>) {
    const responder = access.permissions.has('sos.respond');
    const households = responder
      ? []
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
          (item) => item.householdId,
        );
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.sosAlert.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status === 'active' ? { status: { in: [...ACTIVE_SOS_STATUSES] } } : {}),
          ...(responder
            ? {}
            : { OR: [{ triggeredBy: access.userId }, { householdId: { in: households } }] }),
        },
        orderBy: { triggeredAt: 'desc' },
        take: query.limit,
      });
      return Promise.all(rows.map((row) => this.view(tx, row, false)));
    });
  }

  async detail(access: EstateAccess, alertId: string) {
    const responder = access.permissions.has('sos.respond');
    const alert = await this.db.withTenant(access, (tx) => this.visible(tx, access, alertId));
    const contacts =
      responder && isActiveSos(alert.status) && !alert.isDrill
        ? await this.db.withContext('emergency', (tx) =>
            tx.emergencyContact.findMany({
              where: { userId: alert.triggeredBy },
              select: { name: true, phone: true, relationship: true },
            }),
          )
        : null;
    return this.db.withTenant(access, async (tx) => {
      const timeline = await tx.sosEvent.findMany({
        where: { estateId: access.estateId, alertId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 500,
      });
      return {
        ...(await this.view(tx, alert, false)),
        timeline: timeline.map((event) => ({
          id: event.id,
          type: event.type,
          actorId: event.actorId,
          channel: event.channel,
          payload: event.payload as Record<string, unknown>,
          occurredAt: event.occurredAt.toISOString(),
        })),
        emergencyContacts: contacts,
      };
    });
  }

  /** Location updates from the triggerer, only while the alert is active (AGENTS.md §6.6). */
  async location(
    access: EstateAccess,
    alertId: string,
    input: z.infer<typeof triggerSosSchema>['location'],
  ) {
    if (!input) throw new DomainError('LOCATION_REQUIRED', 'Send a location', 422);
    return this.db.withTenant(access, async (tx) => {
      const alert = await this.visible(tx, access, alertId);
      if (alert.triggeredBy !== access.userId) throw new ForbiddenError();
      if (!isActiveSos(alert.status)) {
        throw new ConflictError(
          'SOS_NOT_ACTIVE',
          'This alert has ended; location is no longer collected',
        );
      }
      await this.saveLocation(tx, alert, input);
      return this.view(tx, alert, false);
    });
  }

  async act(
    access: EstateAccess,
    alertId: string,
    action: SosAction,
    details: {
      assignee?: string;
      resolution?: string;
      falseAlarm?: boolean;
      notes?: string;
      category?: string;
    } = {},
  ) {
    if (action !== 'cancel' && !access.permissions.has('sos.respond')) throw new ForbiddenError();
    if (action === 'close' && !isStaffWith(access, 'incident.manage')) {
      throw new ForbiddenError('A supervisor or manager closes the record');
    }
    if (action === 'assign' && details.assignee) {
      const responders = await this.authz.holdersOf(access.estateId, [...RESPONDER_ROLES]);
      if (!responders.includes(details.assignee)) {
        throw new DomainError(
          'NOT_A_RESPONDER',
          'Assign the alert to a guard or supervisor of this estate',
          422,
        );
      }
    }
    return this.db.withTenant(access, async (tx) => {
      const alert = await this.visible(tx, access, alertId);
      if (action === 'cancel' && alert.triggeredBy !== access.userId) {
        throw new ForbiddenError('Only the person who raised the alert can cancel it');
      }
      const next = nextSosStatus(alert.status, action);
      if (!next) {
        throw new ConflictError(
          'SOS_INVALID_STATE',
          `This alert is ${alert.status} and cannot be changed that way`,
        );
      }
      const now = new Date();
      const data: Prisma.SosAlertUpdateManyMutationInput = {
        status: next,
        version: { increment: 1 },
      };
      if (action === 'cancel') data.cancelledAt = now;
      if (action === 'acknowledge')
        Object.assign(data, { acknowledgedAt: now, acknowledgedBy: access.userId });
      if (action === 'assign') {
        Object.assign(data, { assignedTo: details.assignee ?? access.userId });
        if (!alert.acknowledgedAt)
          Object.assign(data, { acknowledgedAt: now, acknowledgedBy: access.userId });
      }
      if (action === 'responding') {
        Object.assign(data, { respondingAt: now, assignedTo: alert.assignedTo ?? access.userId });
      }
      if (action === 'resolve') {
        Object.assign(data, {
          resolvedAt: now,
          resolvedBy: access.userId,
          resolution: details.resolution ?? null,
          falseAlarm: details.falseAlarm ?? false,
        });
        if (!alert.acknowledgedAt)
          Object.assign(data, { acknowledgedAt: now, acknowledgedBy: access.userId });
      }
      if (action === 'close') {
        Object.assign(data, {
          closedAt: now,
          closedBy: access.userId,
          ...(details.category ? { category: details.category } : {}),
        });
      }
      const updated = await tx.sosAlert.updateMany({
        where: {
          id: alert.id,
          estateId: access.estateId,
          status: alert.status,
          version: alert.version,
        },
        data,
      });
      if (updated.count === 0) {
        throw new ConflictError('SOS_STATE_CHANGED', 'Someone else updated this alert. Reload.');
      }
      const timelineType = SOS_EVENT_FOR_ACTION[action];
      await this.event(tx, alert, timelineType, access.userId, {
        ...(details.assignee ? { assignee: details.assignee } : {}),
        ...(details.resolution
          ? { resolution: details.resolution, falseAlarm: details.falseAlarm ?? false }
          : {}),
        ...(details.notes ? { notes: details.notes } : {}),
      });
      await appendOutboxEvents(tx, [
        {
          type: `emergency.alert.${timelineType}`,
          estateId: access.estateId,
          aggregateType: 'sos_alert',
          aggregateId: alert.id,
          payload: { alertId: alert.id, status: next },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: `emergency.alert.${action}`,
            resourceType: 'sos_alert',
            resourceId: alert.id,
            before: { status: alert.status },
            after: { status: next },
            ...(details.resolution ? { reason: details.resolution } : {}),
          },
        },
      ]);
      return this.view(tx, await tx.sosAlert.findUniqueOrThrow({ where: { id: alert.id } }), false);
    });
  }

  async note(access: EstateAccess, alertId: string, note: string) {
    return this.db.withTenant(access, async (tx) => {
      const alert = await this.visible(tx, access, alertId);
      await this.event(tx, alert, 'note', access.userId, { note });
      return this.view(tx, alert, false);
    });
  }

  /** Emergency broadcast to every active member (emergency.md §8.9). Cannot be muted by recipients. */
  async broadcast(access: EstateAccess, title: string, body: string) {
    const recipients = await this.tenancy.activeMemberIds(access.estateId);
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.emergencyBroadcast.create({
        data: {
          estateId: access.estateId,
          title,
          body,
          sentBy: access.userId,
          recipients: recipients.length,
        },
      });
      for (let start = 0; start < recipients.length; start += BROADCAST_CHUNK) {
        await this.notifications.request(tx, {
          intent: 'emergency.broadcast',
          userIds: recipients.slice(start, start + BROADCAST_CHUNK),
          estateId: access.estateId,
          data: { title, body },
          dedupeKey: `broadcast:${row.id}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'emergency.broadcast.sent',
          estateId: access.estateId,
          aggregateType: 'emergency_broadcast',
          aggregateId: row.id,
          payload: { broadcastId: row.id, recipients: recipients.length },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'emergency.broadcast.send',
            resourceType: 'emergency_broadcast',
            resourceId: row.id,
            after: { title, recipients: recipients.length },
          },
        },
      ]);
      return { id: row.id, recipients: recipients.length, sentAt: row.sentAt.toISOString() };
    });
  }

  // ---- Internals -----------------------------------------------------------------------------

  /** Responders see every alert; others only their own or their household's (as 404 otherwise). */
  private async visible(tx: Tx, access: EstateAccess, alertId: string): Promise<AlertRow> {
    const alert = await tx.sosAlert.findFirst({
      where: { id: alertId, estateId: access.estateId },
    });
    if (!alert) throw new NotFoundError('Alert not found', 'SOS_NOT_FOUND');
    if (access.permissions.has('sos.respond') || alert.triggeredBy === access.userId) return alert;
    if (alert.householdId) {
      const permissions = await this.occupancy.memberPermissions(
        tx,
        access.estateId,
        alert.householdId,
        access.userId,
      );
      if (permissions) return alert;
    }
    throw new NotFoundError('Alert not found', 'SOS_NOT_FOUND');
  }

  private async saveLocation(
    tx: Tx,
    alert: AlertRow,
    input: NonNullable<z.infer<typeof triggerSosSchema>['location']>,
  ) {
    await tx.sosLocation.create({
      data: {
        estateId: alert.estateId,
        alertId: alert.id,
        lat: input.lat,
        lng: input.lng,
        accuracyM: input.accuracyM ?? null,
        capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
      },
    });
  }

  private async event(
    tx: Tx,
    alert: AlertRow,
    type: string,
    actorId: string | null,
    payload: Record<string, unknown>,
  ) {
    await tx.sosEvent.create({
      data: {
        estateId: alert.estateId,
        alertId: alert.id,
        type,
        actorId,
        payload: payload as Prisma.InputJsonObject,
      },
    });
  }

  private async view(tx: Tx, alert: AlertRow, reused: boolean) {
    const [unit] = alert.spaceId
      ? await this.property.spacesByIds(tx, alert.estateId, [alert.spaceId])
      : [];
    const last = await tx.sosLocation.findFirst({
      where: { estateId: alert.estateId, alertId: alert.id },
      orderBy: { capturedAt: 'desc' },
    });
    return {
      id: alert.id,
      status: alert.status as 'triggered',
      category: alert.category as 'general',
      isDrill: alert.isDrill,
      source: alert.source,
      triggeredBy: alert.triggeredBy,
      triggerRole: alert.triggerRole,
      householdId: alert.householdId,
      unitCode: unit?.code ?? null,
      triggeredAt: alert.triggeredAt.toISOString(),
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: alert.acknowledgedBy,
      assignedTo: alert.assignedTo,
      respondingAt: alert.respondingAt?.toISOString() ?? null,
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
      resolution: alert.resolution,
      falseAlarm: alert.falseAlarm,
      closedAt: alert.closedAt?.toISOString() ?? null,
      lastLocation: last
        ? {
            lat: last.lat,
            lng: last.lng,
            accuracyM: last.accuracyM,
            capturedAt: last.capturedAt.toISOString(),
          }
        : null,
      reused,
    };
  }

  /** Drill flag and response times of alerts triggered in the window (estate reports). */
  async alertsBetween(tx: Tx, estateId: string, from: Date, to: Date) {
    return tx.sosAlert.findMany({
      where: { estateId, triggeredAt: { gte: from, lte: to } },
      select: { isDrill: true, triggeredAt: true, acknowledgedAt: true, resolvedAt: true },
    });
  }
}
