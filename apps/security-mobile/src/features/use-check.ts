import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Vibration } from 'react-native';
import { errorText } from '../lib/errors';
import { useGate } from '../lib/gate';
import type { Credential } from '../offline/verify';
import { setVerification } from './verification';

/** Distinct short haptic per decision (UI_GUIDELINES §8.4); colour is never the only signal. */
const HAPTIC = { allow: [0, 60], check: [0, 60, 80, 60], deny: [0, 250] } as const;

/** Runs a QR or PIN check (API first, offline fallback) and opens the full-screen result. */
export function useCheck(direction: 'in' | 'out') {
  const { sync } = useGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(
    async (credential: Credential) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await sync.verify(credential, direction);
        Vibration.vibrate([...HAPTIC[result.decision]]);
        setVerification({ result, direction, checkedAt: Date.now() });
        router.push('/result');
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setBusy(false);
      }
    },
    [busy, direction, sync],
  );

  return { check, busy, error };
}
