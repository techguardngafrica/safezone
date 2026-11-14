import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import { withTenant } from './tenant-context';

describe('withTenant input validation', () => {
  const transaction = vi.fn();
  const client = { $transaction: transaction } as unknown as PrismaClient;

  it.each([
    { estateId: 'not-a-uuid', userId: null },
    { estateId: "'; drop table x; --", userId: null },
    { estateId: '0190f0a4-7c2e-7a1b-9d3e-2f4a5b6c7d8e', userId: 'user-1' },
  ])('rejects %o without opening a transaction', async (context) => {
    await expect(withTenant(client, context, async () => 1)).rejects.toThrow(TypeError);
    expect(transaction).not.toHaveBeenCalled();
  });
});
