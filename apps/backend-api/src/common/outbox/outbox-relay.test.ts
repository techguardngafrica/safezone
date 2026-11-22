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

  it('sends confirmed imports to the imports queue with their audit record', () => {
    expect(routeEvent({ type: 'imports.job.confirmed', audit: { action: 'x' } })).toEqual([
      'audit',
      'imports',
    ]);
  });

  it('keeps marketplace and platform charges on their own queues', () => {
    expect(routeEvent({ type: 'payments.marketplace_charge.succeeded', audit: null })).toEqual([
      'marketplace',
    ]);
    expect(routeEvent({ type: 'payments.platform_charge.succeeded', audit: null })).toEqual([
      'utilities',
    ]);
  });

  it('drops events nobody consumes', () => {
    expect(routeEvent({ type: 'tenancy.estate.viewed', audit: null })).toEqual([]);
  });
});
