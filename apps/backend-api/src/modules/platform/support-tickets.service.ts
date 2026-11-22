import { Injectable } from '@nestjs/common';
import type {
  createSupportTicketMessageSchema,
  createSupportTicketSchema,
  supportTicketListQuerySchema,
  updateSupportTicketSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { z as zod } from 'zod';

const cursorSchema = zod.object({ id: zod.uuid() });
const isIdCursor = (value: unknown): value is { id: string } =>
  cursorSchema.safeParse(value).success;

function slaHoursFor(category: string, priority: string): number {
  // super-admin.md §6.4: gate/SOS issues: 1 hour first response; others: 1 working day (24h).
  if (category === 'gate_sos' || priority === 'critical') return 1;
  if (priority === 'high') return 4;
  return 24;
}

function toView(row: Prisma.SupportTicketGetPayload<object>) {
  return {
    id: row.id,
    estateId: row.estateId,
    requesterUserId: row.requesterUserId,
    requesterName: row.requesterName,
    requesterContact: row.requesterContact,
    channel: row.channel as 'in_app' | 'email' | 'whatsapp' | 'phone' | 'internal',
    category: row.category as
      'gate_sos' | 'onboarding' | 'billing' | 'technical' | 'account' | 'other',
    priority: row.priority as 'critical' | 'high' | 'normal' | 'low',
    subject: row.subject,
    description: row.description,
    status: row.status as 'new' | 'open' | 'pending_customer' | 'resolved' | 'closed',
    assigneeId: row.assigneeId,
    slaDueAt: row.slaDueAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessageView(row: Prisma.SupportTicketMessageGetPayload<object>) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorId: row.authorId,
    body: row.body,
    internal: row.internal,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Platform support tickets (platform.md §3, ADR-0022). */
@Injectable()
export class SupportTicketsService {
  constructor(private readonly db: DatabaseService) {}

  async list(query: z.infer<typeof supportTicketListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isIdCursor) : null;
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.supportTicket.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.priority ? { priority: query.priority } : {}),
          ...(query.estateId ? { estateId: query.estateId } : {}),
          ...(after ? { id: { lt: after.id } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map(toView),
      nextCursor: hasMore ? encodeCursor({ id: page[page.length - 1]!.id }) : null,
    };
  }

  async get(id: string) {
    const row = await this.db.withContext('platform_config', (tx) =>
      tx.supportTicket.findUnique({
        where: { id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      }),
    );
    if (!row) throw new NotFoundError('Support ticket not found');
    return { ...toView(row), messages: row.messages.map(toMessageView) };
  }

  async create(actorId: string, input: z.infer<typeof createSupportTicketSchema>) {
    const slaDueAt = new Date(Date.now() + slaHoursFor(input.category, input.priority) * 3_600_000);
    const row = await this.db.withContext('platform_config', async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          estateId: input.estateId ?? null,
          requesterUserId: input.requesterUserId ?? null,
          requesterName: input.requesterName ?? null,
          requesterContact: input.requesterContact ?? null,
          channel: input.channel,
          category: input.category,
          priority: input.priority,
          subject: input.subject,
          description: input.description,
          slaDueAt,
          createdBy: actorId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.support_ticket.created',
          estateId: null,
          aggregateType: 'support_ticket',
          aggregateId: created.id,
          payload: { ticketId: created.id, priority: created.priority, category: created.category },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.support_ticket.create',
            resourceType: 'support_ticket',
            resourceId: created.id,
            after: {
              subject: created.subject,
              priority: created.priority,
              category: created.category,
            },
          },
        },
      ]);
      return created;
    });
    return toView(row);
  }

  async update(actorId: string, id: string, input: z.infer<typeof updateSupportTicketSchema>) {
    const row = await this.db.withContext('platform_config', async (tx) => {
      const existing = await tx.supportTicket.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Support ticket not found');
      const resolvedAt =
        input.status === 'resolved' || input.status === 'closed'
          ? (existing.resolvedAt ?? new Date())
          : input.status
            ? null
            : existing.resolvedAt;
      const updated = await tx.supportTicket.update({
        where: { id },
        data: {
          ...(input.status !== undefined ? { status: input.status, resolvedAt } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.support_ticket.updated',
          estateId: null,
          aggregateType: 'support_ticket',
          aggregateId: id,
          payload: { ticketId: id, status: updated.status },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.support_ticket.update',
            resourceType: 'support_ticket',
            resourceId: id,
            before: {
              status: existing.status,
              priority: existing.priority,
              assigneeId: existing.assigneeId,
            },
            after: {
              status: updated.status,
              priority: updated.priority,
              assigneeId: updated.assigneeId,
            },
          },
        },
      ]);
      return updated;
    });
    return toView(row);
  }

  async addMessage(
    actorId: string,
    ticketId: string,
    input: z.infer<typeof createSupportTicketMessageSchema>,
  ) {
    const msg = await this.db.withContext('platform_config', async (tx) => {
      const ticket = await tx.supportTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, status: true },
      });
      if (!ticket) throw new NotFoundError('Support ticket not found');
      const created = await tx.supportTicketMessage.create({
        data: { ticketId, authorId: actorId, body: input.body, internal: input.internal },
      });
      if (ticket.status === 'new') {
        await tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'open' } });
      }
      return created;
    });
    return toMessageView(msg);
  }

  async countOpen(): Promise<number> {
    return this.db.withContext('platform_config', (tx) =>
      tx.supportTicket.count({ where: { status: { in: ['new', 'open', 'pending_customer'] } } }),
    );
  }
}
