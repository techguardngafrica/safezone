import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { maskPhone } from '@safezone/auth';
import { getRole } from '@safezone/permissions';
import { DatabaseService } from '../../../common/database/database.service';
import type { RelayedEvent } from '../../../common/outbox/outbox-relay';
import { QueueService } from '../../../common/queues/queue.service';
import { QUEUE_PREFIX, QUEUES } from '../../../common/queues/queues';
import { createWorkerConnection } from '../../../common/queues/worker-connection';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { ContactDeliveryService } from '../../notifications/contact-delivery.service';
import { deriveInvitationToken } from '../domain/invitation-token';

/**
 * Worker consumer of the `onboarding` queue: sends invitation links. The token is derived again here
 * from the invitation id, so it is never stored or carried in events (tenancy.md §4.2).
 */
@Injectable()
export class OnboardingConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OnboardingConsumer');
  private worker: Worker | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly contacts: ContactDeliveryService,
    private readonly queues: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<RelayedEvent>(
      QUEUES.onboarding,
      async (job) => {
        if (job.data.type !== 'tenancy.invitation.sent') return;
        const invitationId = (job.data.payload as { invitationId?: unknown }).invitationId;
        if (typeof invitationId === 'string') await this.sendInvitation(invitationId);
      },
      {
        connection: createWorkerConnection(this.queues.workerConnectionUrl(), this.logger),
        prefix: QUEUE_PREFIX,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn({
        msg: 'onboarding job failed',
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.name,
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  /** Idempotent: revoked, accepted or expired invitations are skipped; each channel is sent once. */
  async sendInvitation(invitationId: string): Promise<void> {
    const invitation = await this.db.withContext('tenancy', async (tx) => {
      const row = await tx.estateInvitation.findUnique({ where: { id: invitationId } });
      if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= new Date()) return null;
      const estate = await tx.estate.findUniqueOrThrow({
        where: { id: row.estateId },
        select: { name: true },
      });
      return { ...row, estateName: estate.name };
    });
    if (!invitation) return;
    const token = deriveInvitationToken(this.env.OTP_HMAC_SECRET, invitation.id);
    await this.contacts.deliver({
      intent: 'onboarding.invitation',
      phone: invitation.phone,
      email: invitation.email,
      data: {
        estateName: invitation.estateName,
        role: getRole(invitation.roleKey)?.name ?? invitation.roleKey,
        phone: maskPhone(invitation.phone),
        link: `${this.env.MANAGEMENT_WEB_URL.replace(/\/$/, '')}/invite/${token}`,
      },
      dedupeKey: `invitation:${invitation.id}`,
    });
  }
}
