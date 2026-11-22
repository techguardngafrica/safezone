import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { maskString } from '../observability/redact';
import { QueueService } from '../queues/queue.service';
import { QUEUES, type QueueName } from '../queues/queues';
import {
  RealtimePublisherService,
  realtimeTargetsForOutbox,
} from '../realtime/realtime-publisher.service';

export interface RelayedEvent {
  id: string;
  type: string;
  version: number;
  estateId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  audit: unknown;
  occurredAt: string;
}

interface OutboxRow {
  id: string;
  type: string;
  version: number;
  estate_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  audit: unknown;
  occurred_at: Date;
}

/** Event types consumed by the notifications module (extended as modules add intents). */
const NOTIFICATION_EVENT_PREFIXES: readonly string[] = ['notifications.'];
const NOTIFICATION_EVENT_TYPES: ReadonlySet<string> = new Set(['identity.refresh.reuse_detected']);

/** Which queues an event goes to. Consumers are idempotent on the event id. */
export function routeEvent(event: Pick<RelayedEvent, 'type' | 'audit'>): QueueName[] {
  const queues: QueueName[] = [];
  if (event.audit) queues.push(QUEUES.audit);
  if (
    NOTIFICATION_EVENT_TYPES.has(event.type) ||
    NOTIFICATION_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix))
  ) {
    queues.push(QUEUES.notifications);
  }
  if (event.type === 'documents.file.uploaded') queues.push(QUEUES.files);
  if (event.type === 'tenancy.invitation.sent') queues.push(QUEUES.onboarding);
  // SOS has its own queue and worker pool; nothing else goes there.
  if (event.type === 'emergency.alert.triggered') queues.push(QUEUES.sos);
  if (event.type === 'payments.webhook.received') queues.push(QUEUES.payments);
  if (event.type.startsWith('payments.platform_charge.')) queues.push(QUEUES.utilities);
  if (event.type.startsWith('payments.marketplace_charge.')) queues.push(QUEUES.marketplace);
  if (event.type === 'platform.export.requested') queues.push(QUEUES.exports);
  if (event.type === 'imports.job.confirmed') queues.push(QUEUES.imports);
  if (event.type === 'billing.invoice.paid') queues.push(QUEUES.facilities);
  if (event.type === 'visitor.pass.shared' || event.type === 'occupancy.occupancy.ended') {
    queues.push(QUEUES.gate);
  }
  return queues;
}

const BATCH_SIZE = 100;
const POLL_MS = 500;
const MAX_ATTEMPTS = 20;

/**
 * Outbox relay (backend-api.md §10). Polls undispatched events with FOR UPDATE SKIP LOCKED, so several
 * worker instances can run it, publishes each to its queues with jobId = event id, then marks it dispatched.
 * A crash between publish and commit republishes the same job id, which BullMQ deduplicates.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OutboxRelay');
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly queues: QueueService,
    @Optional() private readonly realtime?: RealtimePublisherService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.OUTBOX_RELAY_DISABLED === 'true') return;
    this.schedule();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Relays one batch. Returns how many events were dispatched. */
  async relayBatch(): Promise<number> {
    return this.db.withOutboxRelay(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
        select id, type, version, estate_id, aggregate_type, aggregate_id, payload, audit, occurred_at
          from platform.outbox_events
         where dispatched_at is null and attempts < ${MAX_ATTEMPTS}
         order by occurred_at, id
         limit ${BATCH_SIZE}
         for update skip locked`;
        let dispatched = 0;
        for (const row of rows) {
          const event: RelayedEvent = {
            id: row.id,
            type: row.type,
            version: row.version,
            estateId: row.estate_id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            payload: row.payload,
            audit: row.audit,
            occurredAt: row.occurred_at.toISOString(),
          };
          try {
            for (const queue of routeEvent(event)) {
              await this.queues.add(queue, event.type, event, { jobId: event.id });
            }
            if (this.realtime) {
              const targets = realtimeTargetsForOutbox(event);
              if (targets.length > 0) await this.realtime.publishMany(targets);
            }
            await tx.outboxEvent.update({
              where: { id: event.id },
              data: { dispatchedAt: new Date() },
            });
            dispatched += 1;
          } catch (error) {
            const message =
              error instanceof Error ? maskString(error.message).slice(0, 500) : 'publish failed';
            await tx.outboxEvent.update({
              where: { id: event.id },
              data: { attempts: { increment: 1 }, lastError: message },
            });
            this.logger.warn({ msg: 'outbox publish failed', eventId: event.id, type: event.type });
          }
        }
        return dispatched;
      },
      { timeout: 30_000 },
    );
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), POLL_MS);
  }

  private async tick(): Promise<void> {
    if (this.running) return this.schedule();
    this.running = true;
    try {
      // Drain quickly when there is a backlog.
      while (!this.stopped && (await this.relayBatch()) === BATCH_SIZE) {
        /* keep going */
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? maskString(error.message) : 'relay failed');
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
