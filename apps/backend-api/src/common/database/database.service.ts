import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  type ContextOptions,
  type DbContext,
  type TenantContext,
  type TransactionOptions,
  type Tx,
  withContext,
  withOutboxRelay,
  withTenant,
  withUser,
} from './tenant-context';

/**
 * Owns the application connection pool (role safezone_app, which cannot bypass RLS).
 *
 * The base client is deliberately not exposed: tenant data is reached only through `withTenant`,
 * so every query runs with `app.estate_id` set. The pool connects lazily on first query.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DATABASE_POOL_MAX,
        application_name: `safezone-${env.APP_PROCESS}`,
      }),
    });
  }

  withTenant<T>(
    context: TenantContext,
    fn: (tx: Tx) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return withTenant(this.client, context, fn, options);
  }

  withOutboxRelay<T>(fn: (tx: Tx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    return withOutboxRelay(this.client, fn, options);
  }

  /** Platform-level work by one module (ADR-0005). */
  withContext<T>(
    context: DbContext,
    fn: (tx: Tx) => Promise<T>,
    options?: ContextOptions,
  ): Promise<T> {
    return withContext(this.client, context, fn, options);
  }

  /** The signed-in user's own rows in user-owned platform tables. */
  withUser<T>(
    userId: string,
    fn: (tx: Tx) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return withUser(this.client, userId, fn, options);
  }

  /** Readiness probe: true when the database answers. */
  async isReady(): Promise<boolean> {
    try {
      await this.client.$queryRaw`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
