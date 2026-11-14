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
 * Module contexts for platform-level work (ADR-0005). RLS policies on platform tables admit a context
 * by name, so a tenant code path (withTenant) cannot touch them by mistake.
 */
export const DB_CONTEXTS = [
  'identity',
  'authz',
  'tenancy',
  'audit',
  'notifications',
  'files',
  'platform_config',
  'outbox_relay',
] as const;
export type DbContext = (typeof DB_CONTEXTS)[number];

const contextOptionsSchema = z.object({
  userId: z.uuid().nullable().optional(),
  estateId: z.uuid().nullable().optional(),
});

export interface ContextOptions extends TransactionOptions {
  /** Sets app.user_id too (e.g. identity work for a signed-in user). */
  userId?: string | null;
  /** Sets app.estate_id too (e.g. tenancy creating an estate's first rows). */
  estateId?: string | null;
}

/** Runs `fn` in a transaction with `app.context` set to a module context (and optionally user/estate). */
export async function withContext<T>(
  client: PrismaClient,
  context: DbContext,
  fn: (tx: Tx) => Promise<T>,
  options: ContextOptions = {},
): Promise<T> {
  if (!DB_CONTEXTS.includes(context)) throw new TypeError('Unknown database context');
  const parsed = contextOptionsSchema.safeParse({
    userId: options.userId,
    estateId: options.estateId,
  });
  if (!parsed.success) throw new TypeError('withContext requires UUID userId/estateId');
  const { userId, estateId } = parsed.data;
  const { userId: _u, estateId: _e, ...transactionOptions } = options;

  return client.$transaction(async (tx) => {
    await tx.$queryRaw`
      select set_config('app.context', ${context}, true),
             set_config('app.user_id', ${userId ?? ''}, true),
             set_config('app.estate_id', ${estateId ?? ''}, true)`;
    return fn(tx);
  }, transactionOptions);
}

/** Runs `fn` as the signed-in user only: they see their own rows in user-owned platform tables. */
export async function withUser<T>(
  client: PrismaClient,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  if (!z.uuid().safeParse(userId).success) throw new TypeError('withUser requires a UUID userId');
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }, options);
}

/** Runs `fn` in a transaction allowed to read and mark outbox events (worker relay only). */
export function withOutboxRelay<T>(
  client: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return withContext(client, 'outbox_relay', fn, options ?? {});
}

/**
 * Lets another module do its part inside the caller's transaction (ADR-0005, amended in ADR-0008):
 * `app.context` is switched for `fn` and restored afterwards, so the work commits or rolls back with the
 * caller's. Only exported services of the owning module call this, never controllers.
 */
export async function asModule<T>(
  tx: Tx,
  context: DbContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!DB_CONTEXTS.includes(context)) throw new TypeError('Unknown database context');
  const rows = await tx.$queryRaw<{ previous: string | null }[]>`
    select current_setting('app.context', true) as previous`;
  const previous = rows[0]?.previous ?? '';
  await tx.$queryRaw`select set_config('app.context', ${context}, true)`;
  try {
    return await fn(tx);
  } finally {
    await tx.$queryRaw`select set_config('app.context', ${previous}, true)`;
  }
}
