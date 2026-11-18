import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ACCESS_KEY, type AccessRule, Can, permits, rulePermissions } from './auth.decorators';

/** Reads the access rule a decorator stores on a method. */
function ruleOf(decorator: MethodDecorator): AccessRule {
  class Target {
    handler() {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Target.prototype, 'handler');
  if (!descriptor) throw new Error('no handler');
  decorator(Target.prototype, 'handler', descriptor);
  return Reflect.getMetadata(ACCESS_KEY, descriptor.value) as AccessRule;
}

describe('@Can', () => {
  it('stores one permission without alternatives', () => {
    expect(ruleOf(Can('invoice.read'))).toEqual({ kind: 'permission', permission: 'invoice.read' });
  });

  it('stores alternatives, primary first', () => {
    const rule = ruleOf(Can('billing.run.create', 'billing.run.approve'));
    expect(rule).toEqual({
      kind: 'permission',
      permission: 'billing.run.create',
      alternatives: ['billing.run.approve'],
    });
    if (rule.kind !== 'permission') throw new Error('expected a permission rule');
    expect(rulePermissions(rule)).toEqual(['billing.run.create', 'billing.run.approve']);
  });
});

describe('permits', () => {
  const single = { kind: 'permission', permission: 'billing.run.create' } as const;
  const either = { ...single, alternatives: ['billing.run.approve'] } as const;

  it('admits the primary permission', () => {
    expect(permits(single, new Set(['billing.run.create']))).toBe(true);
    expect(permits(either, new Set(['billing.run.create']))).toBe(true);
  });

  it('admits an alternative only when one is declared', () => {
    expect(permits(either, new Set(['billing.run.approve']))).toBe(true);
    expect(permits(single, new Set(['billing.run.approve']))).toBe(false);
  });

  it('refuses when nothing matches', () => {
    expect(permits(either, new Set(['invoice.read', 'payment.make']))).toBe(false);
    expect(permits(either, new Set())).toBe(false);
  });
});
