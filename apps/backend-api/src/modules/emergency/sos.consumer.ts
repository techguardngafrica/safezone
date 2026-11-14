import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import type { RelayedEvent } from '../../common/outbox/outbox-relay';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { QueueService } from '../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../common/queues/queues';
import { createWorkerConnection } from '../../common/queues/worker-connection';
import { AuthzService } from '../authz/authz.service';
import { ContactDeliveryService } from '../notifications/contact-delivery.service';
import { UserDirectory } from '../identity/user-directory.service';
import { DeliveryService } from '../notifications/delivery.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { type EscalationStep, normaliseEscalation, shouldEscalate } from './domain/sos';
import { MANAGER_ROLES, RESPONDER_ROLES } from './sos.service';

export const ESCALATE_JOB = 'escalate';
type AlertRow = Prisma.SosAlertGetPayload<object>;

/**
 * The `sos` queue's own worker pool (AGENTS.md §6.1, emergency.md §5). Only SOS work runs here:
 * initial fan-out to responders (push and SMS together, so one channel failing never silences an alert),
 * emergency contacts for real alerts, and the escalation timers.
 */
@Injectable()
export class SosConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SosConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly db: DatabaseService,
    private readonly delivery: DeliveryService,
    private readonly contacts: ContactDeliveryService,
    private readonly authz: AuthzService,
    private readonly property: PropertyService,
    private readonly tenancy: TenancyService,
    private readonly users: UserDirectory,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker(
      QUEUES.sos,
      async (job) => {
        if (job.name === ESCALATE_JOB) {
          const { estateId, alertId, step } = job.data as {
            estateId: string;
            alertId: string;
            step: number;
          };
          await this.escalate(estateId, alertId, step);
          return;
        }
        const event = job.data as RelayedEvent;
        if (event.type === 'emergency.alert.triggered' && event.estateId) {
          await this.fanOut(event.estateId, (event.payload as { alertId: string }).alertId);
        }
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 20,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error({
        msg: 'SOS job failed',
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  /** Initial fan-out, then schedules escalation steps. Idempotent per alert (dedupe keys, job ids). */
  async fanOut(estateId: string, alertId: string): Promise<void> {
    const alert = await this.load(estateId, alertId);
    if (!alert || alert.status === 'cancelled') return;
    const place = await this.place(alert);
    const label = alert.isDrill ? 'DRILL ' : '';
    const responders = (await this.authz.holdersOf(estateId, [...RESPONDER_ROLES])).filter(
      (userId) => userId !== alert.triggeredBy,
    );
    // Policy steps are scheduled first so a slow provider never delays escalation.
    const settings = await this.tenancy.getSettings({ estateId, userId: null });
    const steps = normaliseEscalation(settings['sos.escalation'] as EscalationStep[]);
    for (const [index, step] of steps.entries()) {
      const fireAt = alert.triggeredAt.getTime() + step.afterSeconds * 1000;
      await this.queues.add(
        QUEUES.sos,
        ESCALATE_JOB,
        { estateId, alertId, step: index },
        { jobId: `sos-${alertId}-step-${index}`, delay: Math.max(0, fireAt - Date.now()) },
      );
    }

    const contactsTask =
      alert.isDrill || alert.triggerRole !== 'resident'
        ? Promise.resolve(0)
        : this.notifyContacts(alert);
    await Promise.all([
      responders.length > 0
        ? this.delivery.deliver({
            intent: 'emergency.sos',
            userIds: responders,
            estateId,
            data: { label, category: alert.category.replace('_', ' '), place, alertId },
            dedupeKey: `sos:${alertId}:initial`,
          })
        : Promise.resolve(),
      contactsTask,
    ]);
    const contacted = await contactsTask;
    await this.timeline(alert, 'notified', null, null, {
      responders: responders.length,
      contacts: contacted,
      channels: ['push', 'sms'],
      ...(responders.length === 0 ? { warning: 'no responders on record' } : {}),
    });
  }

  /** One escalation step: only while nobody has acknowledged (emergency.md §6). */
  async escalate(estateId: string, alertId: string, stepIndex: number): Promise<void> {
    const alert = await this.load(estateId, alertId);
    if (!alert) return;
    const settings = await this.tenancy.getSettings({ estateId, userId: null });
    const step = normaliseEscalation(settings['sos.escalation'] as EscalationStep[])[stepIndex];
    if (!step || !shouldEscalate(alert.status, step, alert.isDrill)) return;
    const place = await this.place(alert);
    const label = alert.isDrill ? 'DRILL ' : '';
    let recipients: string[] = [];
    let contacts = 0;
    if (step.target === 'next_guard') {
      recipients = await this.authz.holdersOf(estateId, [...RESPONDER_ROLES]);
    } else if (step.target === 'supervisor_and_managers') {
      recipients = await this.authz.holdersOf(estateId, ['security_supervisor', ...MANAGER_ROLES]);
    } else {
      // Voice calls need a voice provider (not configured yet); contacts are reached by SMS meanwhile.
      contacts = alert.triggerRole === 'resident' ? await this.notifyContacts(alert) : 0;
    }
    recipients = recipients.filter((userId) => userId !== alert.triggeredBy);
    if (recipients.length > 0) {
      await this.delivery.deliver({
        intent: 'emergency.sos_escalated',
        userIds: recipients,
        estateId,
        data: { label, place, seconds: step.afterSeconds, alertId },
        dedupeKey: `sos:${alertId}:step:${stepIndex}`,
      });
    }
    await this.timeline(alert, 'escalated', null, null, {
      step: stepIndex,
      afterSeconds: step.afterSeconds,
      target: step.target,
      recipients: recipients.length,
      contacts,
      ...(step.target === 'emergency_contacts_voice' ? { voice: 'not_configured_sms_sent' } : {}),
    });
    await this.db.withTenant({ estateId, userId: null }, (tx) =>
      appendOutboxEvents(tx, [
        {
          type: 'emergency.alert.escalated',
          estateId,
          aggregateType: 'sos_alert',
          aggregateId: alertId,
          payload: { alertId, step: stepIndex, target: step.target },
        },
      ]),
    );
  }

  private async notifyContacts(alert: AlertRow): Promise<number> {
    const [contacts, estate, people] = await Promise.all([
      this.db.withContext('emergency', (tx) =>
        tx.emergencyContact.findMany({
          where: { userId: alert.triggeredBy },
          select: { id: true, phone: true },
        }),
      ),
      this.tenancy.getProfile({ estateId: alert.estateId, userId: null }),
      this.users.contactsOf([alert.triggeredBy]),
    ]);
    await Promise.all(
      contacts.map((contact) =>
        this.contacts
          .deliver({
            intent: 'emergency.contact',
            phone: contact.phone,
            email: null,
            data: {
              name: people.get(alert.triggeredBy)?.fullName ?? 'A resident',
              estateName: estate.name,
            },
            dedupeKey: `sos:${alert.id}:contact:${contact.id}`,
          })
          .catch(() => undefined),
      ),
    );
    return contacts.length;
  }

  private async place(alert: AlertRow): Promise<string> {
    if (!alert.spaceId) return 'the estate';
    const [unit] = await this.db.withTenant({ estateId: alert.estateId, userId: null }, (tx) =>
      this.property.spacesByIds(tx, alert.estateId, [alert.spaceId as string]),
    );
    return unit ? `unit ${unit.code}` : 'the estate';
  }

  private load(estateId: string, alertId: string) {
    return this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.sosAlert.findFirst({ where: { id: alertId, estateId } }),
    );
  }

  private timeline(
    alert: AlertRow,
    type: string,
    actorId: string | null,
    channel: string | null,
    payload: Record<string, unknown>,
  ) {
    return this.db.withTenant({ estateId: alert.estateId, userId: null }, (tx) =>
      tx.sosEvent.create({
        data: {
          estateId: alert.estateId,
          alertId: alert.id,
          type,
          actorId,
          channel,
          payload: payload as Prisma.InputJsonObject,
        },
      }),
    );
  }
}
