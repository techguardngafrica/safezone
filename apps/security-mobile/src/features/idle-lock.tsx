import { t } from '@safezone/i18n';
import { useSession } from '@safezone/mobile-ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BodyText, gateStyles } from '../components/gate-ui';
import type { GateDeviceInfo } from '../lib/device';
import { session } from '../lib/session';
import { GuardPinEntry } from './guard-sign-in';
import { useActiveSos } from './sos';

/** security-mobile.md §10: the gate phone locks after 10 minutes without a touch. */
export const IDLE_LOCK_MS = 10 * 60_000;

/**
 * Idle lock for a shared gate phone (ADR-0017 point 7). The session stays alive under the lock, so
 * queued entries keep syncing and SOS polling keeps running; unlocking needs the same guard's PIN. An
 * unacknowledged SOS always lifts the lock so the alarm is never hidden (AGENTS.md §6.1).
 */
export function IdleLock({
  device,
  pinUnlock,
  children,
}: {
  device: GateDeviceInfo;
  /** Guard PIN sessions unlock with the PIN; a phone sign-in on the shared phone just signs out. */
  pinUnlock: boolean;
  children: ReactNode;
}) {
  const user = useSession(session).user;
  const sos = useActiveSos();
  const ringing = (sos.data ?? []).some((alert) => alert.status === 'triggered');
  const [locked, setLocked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pinUnlock) setLocked(true);
      else void session.signOut();
    }, IDLE_LOCK_MS);
  }, [pinUnlock]);

  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm]);

  useEffect(() => {
    if (ringing) {
      setLocked(false);
      arm();
    }
  }, [arm, ringing]);

  const guard = user
    ? {
        userId: user.id,
        displayName: user.fullName ?? '',
        pinSet: true,
        locked: false,
        pinSetAt: null,
      }
    : null;

  return (
    <View style={{ flex: 1 }} onTouchStart={arm}>
      {children}
      <Modal
        visible={locked && !ringing && guard !== null}
        animationType="fade"
        onRequestClose={() => undefined}
      >
        <SafeAreaView style={gateStyles.screen}>
          <ScrollView contentContainerStyle={gateStyles.content}>
            <BodyText muted>{t('sec.lock.title')}</BodyText>
            {guard ? (
              <>
                <BodyText>{t('sec.lock.body', { name: guard.displayName })}</BodyText>
                <GuardPinEntry
                  device={device}
                  guard={guard}
                  replacesSession={!session.getState().offline}
                  onDone={() => {
                    setLocked(false);
                    arm();
                  }}
                  onBack={() => {
                    setLocked(false);
                    void session.signOut();
                  }}
                  backLabel={t('sec.lock.switch')}
                />
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
