import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/common/outbox/outbox-relay';
import { AuditService } from '../../src/modules/audit/audit.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { countRows, signIn, startTestStack, type TestStack } from './support/app';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

describe('outbox relay and audit consumer', () => {
  let stack: TestStack;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  let audit: AuditService;
  let estateId: string;
  let adminToken: string;
  let residentToken: string;

  beforeAll(async () => {
    stack = await startTestStack();
    process.env.OUTBOX_RELAY_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    worker = moduleRef.createNestApplication().enableShutdownHooks();
    await (worker as unknown as { init(): Promise<void> }).init();
    relay = worker.get(OutboxRelay);
    audit = worker.get(AuditService);

    estateId = await stack.createEstate('Audited Estate');
    const adminId = await stack.createUser('+2348032000001');
    await stack.addMember(estateId, adminId, 'estate_administrator');
    adminToken = (await signIn(stack, '+2348032000001')).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [adminId],
    );
    await stack.resetRateLimits();
    const residentId = await stack.createUser('+2348032000002');
    await stack.addMember(estateId, residentId, 'tenant');
    residentToken = (await signIn(stack, '+2348032000002')).accessToken;
  });

  afterAll(async () => {
    await worker?.close();
    await stack?.stop();
  });

  it('relays audited events and writes hash-chained audit records once', async () => {
    await stack.http
      .patch(`/v1/estates/${estateId}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ 'visitor.require_photo': true })
      .expect(200);

    const pending = await countRows(
      stack.db.owner,
      `select count(*) from platform.outbox_events where dispatched_at is null`,
    );
    expect(pending).toBeGreaterThan(0);
    while ((await relay.relayBatch()) > 0) {
      /* drain */
    }
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where dispatched_at is null`,
      ),
    ).toBe(0);

    await waitFor(
      async () =>
        (await countRows(
          stack.db.owner,
          `select count(*) from audit.audit_events where action = 'tenancy.settings.update'`,
        )) === 1,
    );
    await waitFor(
      async () =>
        (await countRows(
          stack.db.owner,
          `select count(*) from audit.audit_events where estate_id is null and action = 'identity.session.create'`,
        )) >= 2,
    );

    expect(await audit.verifyStream(estateId)).toBeNull();
    expect(await audit.verifyStream(null)).toBeNull();

    // Replaying an event (duplicate delivery) records nothing new.
    const { rows } = await stack.db.owner.query(
      `select id, type, version, estate_id, aggregate_type, aggregate_id, payload, audit, occurred_at
         from platform.outbox_events where type = 'tenancy.settings.updated' limit 1`,
    );
    const row = rows[0];
    const recorded = await audit.record({
      id: row.id,
      type: row.type,
      version: row.version,
      estateId: row.estate_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      audit: row.audit,
      occurredAt: new Date(row.occurred_at).toISOString(),
    });
    expect(recorded).toBe(false);
  });

  it('shows the estate audit log to audit.read holders only, with cursor paging', async () => {
    await stack.http
      .patch(`/v1/estates/${estateId}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ 'visitor.max_pass_days': 14 })
      .expect(200);
    while ((await relay.relayBatch()) > 0) {
      /* drain */
    }
    await waitFor(
      async () =>
        (await countRows(
          stack.db.owner,
          `select count(*) from audit.audit_events where estate_id = $1`,
          [estateId],
        )) >= 2,
    );

    const first = await stack.http
      .get(`/v1/estates/${estateId}/audit-events`)
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.nextCursor).toBeTypeOf('string');
    const second = await stack.http
      .get(`/v1/estates/${estateId}/audit-events`)
      .query({ limit: 1, cursor: first.body.meta.nextCursor })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);

    await stack.http
      .get(`/v1/estates/${estateId}/audit-events`)
      .set('Authorization', `Bearer ${residentToken}`)
      .expect(403);
    await stack.http
      .get(`/v1/estates/${estateId}/audit-events`)
      .query({ cursor: 'garbage' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('detects tampering with a chained record', async () => {
    const client = await stack.db.owner.connect();
    try {
      await client.query('alter table audit.audit_events disable trigger audit_events_append_only');
      const { rows } = await client.query(
        `update audit.audit_events set reason = 'tampered'
          where id = (select id from audit.audit_events where estate_id = $1 order by seq limit 1) returning id`,
        [estateId],
      );
      expect(await audit.verifyStream(estateId)).toBe(rows[0].id);
    } finally {
      await client.query('alter table audit.audit_events enable trigger audit_events_append_only');
      client.release();
    }
  });
});
