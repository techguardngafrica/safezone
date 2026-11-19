import { type ApiData, ApiClientError, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { config } from '../lib/config';
import { deviceApi, type GateDeviceInfo, gateDevice, secretStore } from '../lib/device';
import { errorText } from '../lib/errors';
import { session } from '../lib/session';
import { checkPinOffline, reconcileVerifiers, rememberPin } from '../offline/pin-verifier';
import { offlineStore } from '../offline/store';

export type GateGuards = ApiData<'/v1/auth/gate/guards', 'post'>;
export type GateGuard = GateGuards['guards'][number];

const GUARDS_SNAPSHOT = 'device-guards';
const GATE_USER_SNAPSHOT = 'gate-session-user';

/** Whether the signed-in user came in through the guard PIN (not phone sign-in) on this device. */
export function isGateSessionUser(userId: string | undefined): boolean {
  return Boolean(userId) && offlineStore.snapshot<string>(GATE_USER_SNAPSHOT) === userId;
}

/** Phone sign-in on the shared device is a personal session, never a gate one. */
export function forgetGateSessionUser(): void {
  offlineStore.setSnapshot(GATE_USER_SNAPSHOT, null);
}

function isNetwork(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'NETWORK_ERROR';
}

/**
 * Guards who can sign in on this device. Kept on the device for offline sign-in; each fresh list also
 * drops offline PIN verifiers the server no longer backs (PIN changed, locked or reset, guard removed).
 */
export function useGuardList(device: GateDeviceInfo) {
  return useQuery({
    queryKey: ['gate-device', device.deviceId, 'guards'],
    queryFn: async (): Promise<{ list: GateGuards; offline: boolean }> => {
      try {
        const list = await unwrap(
          deviceApi.POST('/v1/auth/gate/guards', {
            body: { deviceCredential: device.credential },
          }),
        );
        const previous = offlineStore.snapshot<GateGuards>(GUARDS_SNAPSHOT);
        const known = new Set([
          ...(previous?.guards ?? []).map((guard) => guard.userId),
          ...list.guards.map((guard) => guard.userId),
        ]);
        await reconcileVerifiers(secretStore, [...known], list.guards);
        offlineStore.setSnapshot(GUARDS_SNAPSHOT, list);
        return { list, offline: false };
      } catch (error) {
        if (error instanceof ApiClientError && error.code === 'GATE_DEVICE_INVALID') {
          const previous = offlineStore.snapshot<GateGuards>(GUARDS_SNAPSHOT);
          await gateDevice.forget((previous?.guards ?? []).map((guard) => guard.userId));
          throw error;
        }
        const saved = offlineStore.snapshot<GateGuards>(GUARDS_SNAPSHOT);
        if (saved && isNetwork(error)) return { list: saved, offline: true };
        throw error;
      }
    },
    refetchInterval: 5 * 60_000,
  });
}

export type GuardSignInOutcome =
  { kind: 'online' } | { kind: 'offline' } | { kind: 'failed'; message: string };

/**
 * PIN sign-in for one guard on this device: the API first; with no connection, the offline verifier
 * (ADR-0017 point 6). A successful online sign-in refreshes the verifier.
 */
export async function signInGuard(
  device: GateDeviceInfo,
  guard: GateGuard,
  pin: string,
  /** Idle unlock: the session being replaced, ended once the new one exists. */
  previousAccessToken?: string | null,
): Promise<GuardSignInOutcome> {
  try {
    const result = await unwrap(
      deviceApi.POST('/v1/auth/gate/signin', {
        body: {
          deviceCredential: device.credential,
          userId: guard.userId,
          pin,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          appVersion: config.appVersion,
        },
      }),
    );
    offlineStore.setSnapshot(GATE_USER_SNAPSHOT, guard.userId);
    await session.acceptSignIn(result);
    if (previousAccessToken)
      await deviceApi
        .POST('/v1/auth/signout', { headers: { Authorization: `Bearer ${previousAccessToken}` } })
        .catch(() => undefined);
    await rememberPin(secretStore, {
      userId: guard.userId,
      displayName: guard.displayName,
      fullName: result.user.fullName,
      pin,
      pinSetAt: result.pinSetAt,
    }).catch(() => undefined);
    return { kind: 'online' };
  } catch (error) {
    if (!isNetwork(error)) return { kind: 'failed', message: errorText(error) };
    const check = await checkPinOffline(secretStore, guard.userId, pin);
    if (check === 'ok') {
      offlineStore.setSnapshot(GATE_USER_SNAPSHOT, guard.userId);
      await session.signInOffline({
        id: guard.userId,
        phone: '',
        fullName: guard.displayName,
        mfaEnabled: true,
      });
      return { kind: 'offline' };
    }
    if (check === 'wrong') return { kind: 'failed', message: t('sec.guard.wrong') };
    if (check === 'wiped')
      return { kind: 'failed', message: t('sec.guard.offlineWiped', { name: guard.displayName }) };
    return {
      kind: 'failed',
      message: t('sec.guard.offlineUnavailable', { name: guard.displayName }),
    };
  }
}
