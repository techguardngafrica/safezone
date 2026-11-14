import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { DatabaseService } from '../../common/database/database.service';
import type { RelayedEvent } from '../../common/outbox/outbox-relay';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { QueueService } from '../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../common/queues/queues';
import { createWorkerConnection } from '../../common/queues/worker-connection';
import { ContactDeliveryService } from '../notifications/contact-delivery.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { PassKeysService } from './pass-keys.service';

/**
 * Worker consumer of the `gate` queue (visitor side):
 * - `visitor.pass.shared`: sends the pass link and PIN to the visitor (derived here, never stored).
 * - `occupancy.occupancy.ended`: revokes the household's unexpired passes (visitor.md §7.4, target < 1 min).
 */
@Injectable()
export class VisitorConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('VisitorConsumer');
  private worker: Worker | undefined;

  constructor(
    private readonly db: DatabaseService,
    private readonly keys: PassKeysService,
    private readonly contacts: ContactDeliveryService,
    private readonly tenancy: TenancyService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<RelayedEvent>(
      QUEUES.gate,
      async (job) => {
        const event = job.data;
        if (!event.estateId) return;
        if (event.type === 'visitor.pass.shared')
          await this.sharePass(event.estateId, event.payload);
        if (event.type === 'occupancy.occupancy.ended')
          await this.revokeHousehold(event.estateId, event.payload);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 8,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'gate job failed',
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async sharePass(estateId: string, payload: unknown): Promise<void> {
    const { passId, shareId } = payload as { passId?: string; shareId?: string };
    if (!passId || !shareId) return;
    const pass = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.visitorPass.findFirst({ where: { id: passId, estateId } }),
    );
    if (!pass?.visitorPhone || pass.revokedAt || pass.validTo < new Date()) return;
    const estate = await this.tenancy.getProfile({ estateId, userId: null });
    const details = { pass, estateName: estate.name };
    await this.contacts.deliver({
      intent: 'visitor.pass',
      phone: details.pass.visitorPhone,
      email: null,
      data: {
        host: 'Your host',
        estateName: details.estateName,
        pin: this.keys.unwrapPin(details.pass.pinWrapped),
        link: this.keys.passUrl(estateId, passId),
      },
      dedupeKey: `pass:${passId}:share:${shareId}`,
    });
  }

  async revokeHousehold(estateId: string, payload: unknown): Promise<number> {
    const { householdId, occupancyId } = payload as { householdId?: string; occupancyId?: string };
    if (!householdId) return 0;
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const passes = await tx.visitorPass.findMany({
        where: {
          estateId,
          revokedAt: null,
          validTo: { gt: new Date() },
          invitation: { hostHouseholdId: householdId },
        },
        select: { id: true },
      });
      if (passes.length === 0) return 0;
      await tx.visitorPass.updateMany({
        where: { id: { in: passes.map((pass) => pass.id) } },
        data: { revokedAt: new Date(), revocationReason: 'occupancy ended' },
      });
      await appendOutboxEvents(
        tx,
        passes.map((pass) => ({
          type: 'visitor.pass.revoked',
          estateId,
          aggregateType: 'visitor_pass',
          aggregateId: pass.id,
          payload: { passId: pass.id, cause: 'occupancy_ended', occupancyId: occupancyId ?? null },
          audit: {
            actorType: 'system' as const,
            action: 'visitor.pass.revoke',
            resourceType: 'visitor_pass',
            resourceId: pass.id,
            reason: 'occupancy ended',
          },
        })),
      );
      return passes.length;
    });
  }
}
