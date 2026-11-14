import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../database/tenant-context';

/** `<module>.<entity>.<past-tense-verb>`, snake_case segments (AGENTS.md §5.5). */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface OutboxEventInput {
  type: string;
  version?: number;
  /** Null only for platform-level events. Must match the transaction's estate otherwise (RLS check). */
  estateId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
}

const outboxEventSchema = z.object({
  type: z
    .string()
    .regex(EVENT_TYPE_PATTERN, 'event type must be <module>.<entity>.<past-tense-verb>'),
  version: z.number().int().min(1).max(32767).default(1),
  estateId: z.uuid().nullable(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().min(1).max(200),
});

/**
 * Appends events in the caller's transaction so they commit or roll back with the state change.
 *
 * Uses createMany: it issues INSERT without RETURNING, which the outbox RLS policies require
 * (only the relay context may read rows back).
 */
export async function appendOutboxEvents(
  tx: Tx,
  events: readonly OutboxEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  const data = events.map((event) => {
    const meta = outboxEventSchema.parse(event);
    return { ...meta, payload: event.payload };
  });
  await tx.outboxEvent.createMany({ data });
}
