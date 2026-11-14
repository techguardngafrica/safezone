import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOutboxRelay, withTenant } from '../../../src/common/database/tenant-context';
import { appendOutboxEvents } from '../../../src/common/outbox/outbox-writer';
import { runPrisma, startTestDatabase, type TestDatabase } from '../support/database';

const estateA = randomUUID();
const estateB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();

function auditRow(estateId: string, action: string) {
  return {
    estateId,
    actorType: 'user',
    action,
    resourceType: 'test_resource',
    resourceId: randomUUID(),
    hash: 'test-hash',
  };
}

describe('database: roles, RLS and tenant context', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    await withTenant(db.app, { estateId: estateA, userId: userA }, (tx) =>
      tx.auditEvent.create({ data: auditRow(estateA, 'seed.a') }),
    );
    await withTenant(db.app, { estateId: estateB, userId: userB }, (tx) =>
      tx.auditEvent.create({ data: auditRow(estateB, 'seed.b') }),
    );
  });

  afterAll(async () => {
    await db?.stop();
  });

  describe('migrations', () => {
    it('match schema.prisma (no drift)', () => {
      // --exit-code makes a non-empty diff exit with 2, which execFileSync throws on.
      expect(() =>
        runPrisma(db.ownerUrl, [
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        ]),
      ).not.toThrow();
    });
  });

  describe('roles', () => {
    it('safezone_app cannot bypass RLS', async () => {
      const { rows } = await db.owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `select rolsuper, rolbypassrls from pg_roles where rolname = 'safezone_app'`,
      );
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    });

    it('every table in platform, tenant and audit has RLS enabled and forced', async () => {
      const { rows } = await db.owner.query<{ table: string }>(
        `select n.nspname || '.' || c.relname as table
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('platform', 'tenant', 'audit')
            and c.relkind in ('r', 'p')
            and not (c.relrowsecurity and c.relforcerowsecurity)`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('withTenant', () => {
    it('only shows the current estate rows', async () => {
      const seenByA = await withTenant(db.app, { estateId: estateA, userId: userA }, (tx) =>
        tx.auditEvent.findMany({ select: { estateId: true } }),
      );
      expect(seenByA.length).toBeGreaterThan(0);
      expect(seenByA.every((row) => row.estateId === estateA)).toBe(true);

      const seenByB = await withTenant(db.app, { estateId: estateB, userId: userB }, (tx) =>
        tx.auditEvent.findMany({ select: { estateId: true } }),
      );
      expect(seenByB.every((row) => row.estateId === estateB)).toBe(true);
    });

    it('shows nothing when no estate is set (fails closed)', async () => {
      const count = await db.app.auditEvent.count();
      expect(count).toBe(0);
    });

    it('rejects writing a row into another estate', async () => {
      await expect(
        withTenant(db.app, { estateId: estateA, userId: userA }, (tx) =>
          tx.auditEvent.create({ data: auditRow(estateB, 'cross.write') }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('does not leak settings to the next transaction on the same connection', async () => {
      const single = db.createAppClient({ max: 1 });
      await withTenant(single, { estateId: estateA, userId: userA }, async () => undefined);
      const rows = await single.$queryRaw<{ estate: string | null; user: string | null }[]>`
        select current_setting('app.estate_id', true) as estate,
               current_setting('app.user_id', true) as user`;
      expect(rows[0]?.estate ?? '').toBe('');
      expect(rows[0]?.user ?? '').toBe('');
      expect(await single.auditEvent.count()).toBe(0);
    });

    it('sets app.user_id for the transaction', async () => {
      const rows = await withTenant(
        db.app,
        { estateId: estateA, userId: userA },
        (tx) => tx.$queryRaw<{ user: string }[]>`select current_setting('app.user_id') as user`,
      );
      expect(rows[0]?.user).toBe(userA);
    });

    it('rejects ids that are not UUIDs before touching the database', async () => {
      await expect(
        withTenant(
          db.app,
          { estateId: "x'; drop table audit.audit_events; --", userId: null },
          async () => 1,
        ),
      ).rejects.toThrow(TypeError);
    });
  });

  describe('audit_events is append-only', () => {
    it('safezone_app cannot UPDATE or DELETE', async () => {
      await expect(
        withTenant(db.app, { estateId: estateA, userId: userA }, (tx) =>
          tx.auditEvent.updateMany({ data: { reason: 'tampered' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withTenant(db.app, { estateId: estateA, userId: userA }, (tx) =>
          tx.auditEvent.deleteMany({}),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('even the owner cannot UPDATE or DELETE rows', async () => {
      await expect(db.owner.query(`update audit.audit_events set reason = 'x'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(db.owner.query(`delete from audit.audit_events`)).rejects.toThrow(/append-only/);
    });
  });

  describe('outbox', () => {
    it('commits events with the transaction and hides them from tenant code', async () => {
      const aggregateId = randomUUID();
      const visibleInTenant = await withTenant(
        db.app,
        { estateId: estateA, userId: userA },
        async (tx) => {
          await appendOutboxEvents(tx, [
            {
              type: 'test.thing.created',
              estateId: estateA,
              aggregateType: 'thing',
              aggregateId,
              payload: { ok: true },
            },
          ]);
          return tx.outboxEvent.count();
        },
      );
      expect(visibleInTenant).toBe(0);

      const relayed = await withOutboxRelay(db.app, (tx) =>
        tx.outboxEvent.findMany({ where: { aggregateId } }),
      );
      expect(relayed).toHaveLength(1);
      expect(relayed[0]).toMatchObject({
        type: 'test.thing.created',
        estateId: estateA,
        version: 1,
      });
    });

    it('rolls events back with the transaction', async () => {
      const aggregateId = randomUUID();
      await expect(
        withTenant(db.app, { estateId: estateA, userId: userA }, async (tx) => {
          await appendOutboxEvents(tx, [
            {
              type: 'test.thing.created',
              estateId: estateA,
              aggregateType: 'thing',
              aggregateId,
              payload: {},
            },
          ]);
          throw new Error('state change failed');
        }),
      ).rejects.toThrow('state change failed');

      const relayed = await withOutboxRelay(db.app, (tx) =>
        tx.outboxEvent.count({ where: { aggregateId } }),
      );
      expect(relayed).toBe(0);
    });

    it('rejects an event for another estate', async () => {
      await expect(
        withTenant(db.app, { estateId: estateA, userId: userA }, (tx) =>
          appendOutboxEvents(tx, [
            {
              type: 'test.thing.created',
              estateId: estateB,
              aggregateType: 'thing',
              aggregateId: randomUUID(),
              payload: {},
            },
          ]),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('lets the relay mark events dispatched', async () => {
      const updated = await withOutboxRelay(db.app, (tx) =>
        tx.outboxEvent.updateMany({
          where: { dispatchedAt: null },
          data: { dispatchedAt: new Date(), attempts: { increment: 1 } },
        }),
      );
      expect(updated.count).toBeGreaterThan(0);
    });
  });
});
