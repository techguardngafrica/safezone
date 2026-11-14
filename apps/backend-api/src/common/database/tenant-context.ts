import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

/** Transaction client handed to repositories. Never use the base client for tenant data. */
export type Tx = Prisma.TransactionClient;

export interface TenantContext {
  estateId: string;
  /** Null for system work done on behalf of an estate (worker jobs, webhooks). */
  userId: string | null;
}

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

const tenantContextSchema = z.object({
  estateId: z.uuid(),
  userId: z.uuid().nullable(),
});

/**
 * Runs `fn` in one transaction scoped to an estate (AGENTS.md §5.2, ADR-0001).
 *
 * `set_config(name, value, true)` is the parameterisable form of `SET LOCAL`: the settings end with the
 * transaction, so they never leak to the next user of a pooled connection. RLS policies read them with
 * `nullif(current_setting('app.estate_id', true), '')::uuid`.
 */
export async function withTenant<T>(
  client: PrismaClient,
  context: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const parsed = tenantContextSchema.safeParse(context);
  if (!parsed.success) {
    // Programmer error: never echo the values, they may be user input.
    throw new TypeError('withTenant requires a UUID estateId and a UUID or null userId');
  }
  const { estateId, userId } = parsed.data;

  return client.$transaction(async (tx) => {
    await tx.$queryRaw`
      select set_config('app.estate_id', ${estateId}, true),
             set_config('app.user_id', ${userId ?? ''}, true)`;
    return fn(tx);
  }, options);
}

/**
 * Runs `fn` in a transaction allowed to read and mark outbox events (worker relay only).
 * No estate is set, so tenant tables stay invisible inside it.
 */
export async function withOutboxRelay<T>(
  client: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('app.context', 'outbox_relay', true)`;
    return fn(tx);
  }, options);
}
