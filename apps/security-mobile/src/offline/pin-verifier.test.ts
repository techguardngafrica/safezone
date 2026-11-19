import { describe, expect, it } from 'vitest';
import {
  checkPinOffline,
  readVerifier,
  reconcileVerifiers,
  rememberPin,
  type SecretStore,
} from './pin-verifier';

const GUARD = '0193a1b2-0000-7000-8000-0000000000c1';
const NOW = new Date('2026-11-19T10:00:00Z');
const SET_AT = '2026-11-18T08:00:00.000Z';

function memoryStore(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}

async function remembered() {
  const store = memoryStore();
  await rememberPin(
    store,
    {
      userId: GUARD,
      displayName: 'Musa B.',
      fullName: 'Musa Bello',
      pin: '482913',
      pinSetAt: SET_AT,
    },
    NOW,
  );
  return store;
}

describe('offline PIN verifier', () => {
  it('never stores the PIN itself', async () => {
    const store = await remembered();
    const stored = [...store.values.values()].join('');
    expect(stored).not.toContain('482913');
    expect(JSON.parse(stored)).toMatchObject({ userId: GUARD, failedAttempts: 0 });
  });

  it('accepts the right PIN and rejects a wrong one', async () => {
    const store = await remembered();
    expect(await checkPinOffline(store, GUARD, '482913', NOW)).toBe('ok');
    expect(await checkPinOffline(store, GUARD, '482914', NOW)).toBe('wrong');
  });

  it('wipes the verifier on the fifth wrong PIN', async () => {
    const store = await remembered();
    for (let attempt = 0; attempt < 4; attempt++)
      expect(await checkPinOffline(store, GUARD, '000111', NOW)).toBe('wrong');
    expect(await checkPinOffline(store, GUARD, '000111', NOW)).toBe('wiped');
    expect(await checkPinOffline(store, GUARD, '482913', NOW)).toBe('unavailable');
  });

  it('resets the wrong count after a right PIN', async () => {
    const store = await remembered();
    await checkPinOffline(store, GUARD, '000111', NOW);
    await checkPinOffline(store, GUARD, '482913', NOW);
    expect((await readVerifier(store, GUARD, NOW))?.failedAttempts).toBe(0);
  });

  it('expires after 7 days', async () => {
    const store = await remembered();
    const later = new Date(NOW.getTime() + 7 * 86_400_000 + 1000);
    expect(await checkPinOffline(store, GUARD, '482913', later)).toBe('unavailable');
    expect(store.values.size).toBe(0);
  });

  it('drops verifiers the server no longer backs', async () => {
    const cases = [
      [],
      [{ userId: GUARD, pinSet: false, locked: false, pinSetAt: null }],
      [{ userId: GUARD, pinSet: true, locked: true, pinSetAt: SET_AT }],
      [{ userId: GUARD, pinSet: true, locked: false, pinSetAt: '2026-11-19T09:00:00.000Z' }],
    ];
    for (const guards of cases) {
      const store = await remembered();
      await reconcileVerifiers(store, [GUARD], guards);
      expect(store.values.size).toBe(0);
    }
    const kept = await remembered();
    await reconcileVerifiers(
      kept,
      [GUARD],
      [{ userId: GUARD, pinSet: true, locked: false, pinSetAt: SET_AT }],
    );
    expect(kept.values.size).toBe(1);
  });
});
