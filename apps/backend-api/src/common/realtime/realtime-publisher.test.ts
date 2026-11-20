import { describe, expect, it } from 'vitest';
import { realtimeTargetsForOutbox } from './realtime-publisher.service';

const ESTATE = '0195a000-0000-7000-8000-000000000001';
const GATE = '0195a000-0000-7000-8000-000000000002';
const CHANNEL = '0195a000-0000-7000-8000-000000000003';

describe('realtimeTargetsForOutbox', () => {
  it('routes SOS alert events to sos and dashboard rooms', () => {
    const targets = realtimeTargetsForOutbox({
      type: 'emergency.alert.triggered',
      estateId: ESTATE,
      aggregateId: 'agg-1',
      payload: { alertId: 'agg-1' },
      occurredAt: '2026-11-20T00:00:00.000Z',
    });
    expect(targets.map((t) => t.room)).toEqual([
      `estate:${ESTATE}:sos`,
      `estate:${ESTATE}:dashboard`,
    ]);
    expect(targets[0]?.event).toBe('sos:update');
  });

  it('routes gate and walkin events to security and specific gate rooms', () => {
    const targets = realtimeTargetsForOutbox({
      type: 'visitor.gate.entered',
      estateId: ESTATE,
      aggregateId: 'agg-2',
      payload: { gateId: GATE },
      occurredAt: '2026-11-20T00:00:00.000Z',
    });
    expect(targets.map((t) => t.room)).toEqual([
      `estate:${ESTATE}:security`,
      `estate:${ESTATE}:gate:${GATE}`,
    ]);
    expect(targets[0]?.event).toBe('gate:update');
  });

  it('routes channel messages to channel room', () => {
    const targets = realtimeTargetsForOutbox({
      type: 'community.message.created',
      estateId: ESTATE,
      aggregateId: 'msg-1',
      payload: { channelId: CHANNEL },
      occurredAt: '2026-11-20T00:00:00.000Z',
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.room).toBe(`estate:${ESTATE}:channel:${CHANNEL}`);
    expect(targets[0]?.event).toBe('channel:message');
  });

  it('ignores non-realtime outbox events', () => {
    expect(
      realtimeTargetsForOutbox({
        type: 'billing.invoice.issued',
        estateId: ESTATE,
        aggregateId: 'inv-1',
        payload: {},
        occurredAt: '2026-11-20T00:00:00.000Z',
      }),
    ).toEqual([]);
  });
});
