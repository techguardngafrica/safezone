import { describe, expect, it } from 'vitest';
import { routeEvent } from './outbox-relay';

describe('routeEvent', () => {
  it('sends audited events to the audit queue', () => {
    expect(routeEvent({ type: 'tenancy.settings.updated', audit: { action: 'x' } })).toEqual([
      'audit',
    ]);
  });

  it('sends notification requests and mapped domain events to notifications', () => {
    expect(routeEvent({ type: 'notifications.request.created', audit: null })).toEqual([
      'notifications',
    ]);
    expect(routeEvent({ type: 'identity.refresh.reuse_detected', audit: { action: 'x' } })).toEqual(
      ['audit', 'notifications'],
    );
  });

  it('drops events nobody consumes', () => {
    expect(routeEvent({ type: 'tenancy.estate.viewed', audit: null })).toEqual([]);
  });
});
