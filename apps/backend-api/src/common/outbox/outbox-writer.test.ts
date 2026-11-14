import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '../database/tenant-context';
import { appendOutboxEvents, EVENT_TYPE_PATTERN, type OutboxEventInput } from './outbox-writer';

const estateId = '0190f0a4-7c2e-7a1b-9d3e-2f4a5b6c7d8e';

function fakeTx() {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  return { tx: { outboxEvent: { createMany } } as unknown as Tx, createMany };
}

function event(overrides: Partial<OutboxEventInput> = {}): OutboxEventInput {
  return {
    type: 'visitor.pass.revoked',
    estateId,
    aggregateType: 'visitor_pass',
    aggregateId: 'pass-1',
    payload: { reason: 'expired' },
    ...overrides,
  };
}

describe('EVENT_TYPE_PATTERN', () => {
  it.each(['visitor.pass.revoked', 'emergency.sos_alert.acknowledged', 'tenancy.estate.approved'])(
    'accepts %s',
    (type) => expect(EVENT_TYPE_PATTERN.test(type)).toBe(true),
  );

  it.each([
    'visitor.pass',
    'Visitor.Pass.Revoked',
    'visitor.pass.revoked.extra',
    'visitor..revoked',
    '',
  ])('rejects %s', (type) => expect(EVENT_TYPE_PATTERN.test(type)).toBe(false));
});

describe('appendOutboxEvents', () => {
  it('writes all events in one createMany with version 1 by default', async () => {
    const { tx, createMany } = fakeTx();
    await appendOutboxEvents(tx, [event(), event({ type: 'visitor.pass.created', version: 2 })]);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]).toEqual({
      data: [
        expect.objectContaining({ type: 'visitor.pass.revoked', version: 1, estateId }),
        expect.objectContaining({ type: 'visitor.pass.created', version: 2 }),
      ],
    });
  });

  it('does nothing for an empty list', async () => {
    const { tx, createMany } = fakeTx();
    await appendOutboxEvents(tx, []);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('accepts platform-level events without an estate', async () => {
    const { tx, createMany } = fakeTx();
    await appendOutboxEvents(tx, [
      event({ estateId: null, type: 'tenancy.application.submitted' }),
    ]);
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a badly named event and writes nothing', async () => {
    const { tx, createMany } = fakeTx();
    await expect(
      appendOutboxEvents(tx, [event(), event({ type: 'PassRevoked' })]),
    ).rejects.toThrow();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('rejects an estate id that is not a UUID', async () => {
    const { tx } = fakeTx();
    await expect(appendOutboxEvents(tx, [event({ estateId: 'estate-a' })])).rejects.toThrow();
  });
});
