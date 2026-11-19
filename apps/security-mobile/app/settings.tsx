import { formatDateTime, t } from '@safezone/i18n';
import { ConfirmModal } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BackRow,
  BigButton,
  BodyText,
  Fact,
  gateStyles,
  GateTitle,
} from '../src/components/gate-ui';
import { useSession } from '@safezone/mobile-ui';
import { isGateSessionUser } from '../src/features/guard-auth';
import { useGateDevice } from '../src/lib/device';
import { useGate } from '../src/lib/gate';
import { session } from '../src/lib/session';

/** Gate settings: which gate this phone serves, manual sync, and sign-out at shift end. */
export default function SettingsScreen() {
  const {
    gate,
    estateName,
    chooseGate,
    sync,
    memberships,
    switchEstate,
    estateId,
    fixedDevice,
    can,
  } = useGate();
  const { device } = useGateDevice();
  const state = useSession(session);
  // Phone sign-in (not a guard PIN session) may set a PIN and register the phone.
  const personal = !state.offline && !isGateSessionUser(state.user?.id);
  const [syncing, setSyncing] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const syncNow = async () => {
    setSyncing(true);
    await sync.refresh();
    setSyncing(false);
  };

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <BackRow onBack={() => router.back()} />
        <GateTitle>{t('sec.settings.title')}</GateTitle>
        <Fact label={t('sec.settings.estate')} value={estateName} />
        <Fact label={t('sec.settings.gate')} value={gate?.name ?? ''} />
        <BodyText muted>
          {sync.lastSyncAt
            ? t('sec.settings.lastSync', { time: formatDateTime(sync.lastSyncAt) })
            : t('sec.settings.neverSynced')}
        </BodyText>
        <BodyText>{t('sec.settings.pending', { count: sync.pendingCount })}</BodyText>
        <BigButton
          label={t('sec.settings.syncNow')}
          icon="sync-outline"
          busy={syncing}
          disabled={!sync.online}
          onPress={() => void syncNow()}
        />
        {device ? (
          <BodyText>
            {t('sec.device.registered', { name: device.deviceName, gate: device.gateName })}
          </BodyText>
        ) : null}
        {!fixedDevice ? (
          <>
            <BigButton
              label={t('sec.settings.changeGate')}
              tone="outline"
              icon="swap-horizontal-outline"
              onPress={() => chooseGate(null)}
            />
            {memberships
              .filter((membership) => membership.estate.id !== estateId)
              .map((membership) => (
                <BigButton
                  key={membership.estate.id}
                  label={`${t('sec.switchEstate')}: ${membership.estate.name}`}
                  tone="outline"
                  icon="business-outline"
                  onPress={() => switchEstate(membership.estate.id)}
                />
              ))}
          </>
        ) : null}
        {personal && can('gate.verify') ? (
          <BigButton
            label={t('sec.pinSetup.open')}
            tone="outline"
            icon="keypad-outline"
            onPress={() => router.push('/pin-setup')}
          />
        ) : null}
        {personal && !device && can('gate.device.manage') ? (
          <BigButton
            label={t('sec.device.register')}
            tone="outline"
            icon="phone-portrait-outline"
            onPress={() => router.push('/register-device')}
          />
        ) : null}
        <BigButton
          label={t('sec.shift.end')}
          tone="outline"
          icon="stop-outline"
          onPress={() => router.push('/shift')}
        />
        <BigButton
          label={t('auth.signOut')}
          tone="outline"
          icon="log-out-outline"
          onPress={() => setConfirmSignOut(true)}
        />
      </ScrollView>
      <ConfirmModal
        visible={confirmSignOut}
        title={t('sec.settings.signOutTitle')}
        body={
          sync.pendingCount > 0
            ? `${t('sec.settings.signOutBody')} ${t('sec.settings.signOutPending', { count: sync.pendingCount })}`
            : t('sec.settings.signOutBody')
        }
        confirmLabel={t('auth.signOut')}
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          void session.signOut();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </SafeAreaView>
  );
}
