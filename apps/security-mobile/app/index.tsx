import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { formatTime, t } from '@safezone/i18n';
import { useSession } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BodyText, GateTile, gateStyles, StatusBar } from '../src/components/gate-ui';
import { Icon } from '../src/components/icon';
import { useCurrentShift } from '../src/features/shift';
import { useActiveSos } from '../src/features/sos';
import { useGate } from '../src/lib/gate';
import { session } from '../src/lib/session';

/** Passes in the cached list that can still be used at this gate today (WAT). */
function useExpectedCount(): number {
  const { sync, gate } = useGate();
  return useMemo(() => {
    const now = Date.now();
    return (sync.expected?.passes ?? []).filter(
      (pass) =>
        new Date(pass.validTo).getTime() >= now &&
        !sync.revokedPassIds.has(pass.id) &&
        (pass.gateIds.length === 0 || (gate ? pass.gateIds.includes(gate.id) : true)) &&
        (pass.maxUses === null || pass.usesCount < pass.maxUses),
    ).length;
  }, [gate, sync.expected, sync.revokedPassIds]);
}

/** Prompts the guard to start a shift; shows the shift start time once on shift. */
function ShiftBanner() {
  const shift = useCurrentShift();
  if (!shift.data) return null;
  const mine = shift.data.mine;
  const label = mine
    ? t('sec.shift.since', { time: formatTime(mine.startedAt) })
    : t('sec.shift.none');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/shift')}
      style={({ pressed }) => [
        styles.shift,
        !mine && styles.shiftNone,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Icon
        name={mine ? 'time-outline' : 'play-circle-outline'}
        size={28}
        color={mine ? colors.brand.primary : colors.neutral[0]}
      />
      <Text style={[styles.shiftText, !mine && { color: colors.neutral[0] }]}>{label}</Text>
    </Pressable>
  );
}

function SosBanner() {
  const active = useActiveSos();
  const count = active.data?.length ?? 0;
  if (count === 0) return null;
  const label = count === 1 ? t('sec.sosBanner.one') : t('sec.sosBanner.many', { count });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityLiveRegion="assertive"
      onPress={() => {
        const [first] = active.data ?? [];
        if (count === 1 && first) router.push(`/sos/${first.id}`);
        else router.push('/sos');
      }}
      style={({ pressed }) => [styles.sos, pressed && { opacity: 0.85 }]}
    >
      <Icon name="warning" size={32} color={colors.neutral[0]} />
      <Text style={styles.sosText}>{label}</Text>
    </Pressable>
  );
}

/** Gate mode home (security-mobile.md §6, UI_GUIDELINES §8.4). No ads anywhere in this app. */
export default function GateHome() {
  useKeepAwake();
  const { gate, estateName, sync, can } = useGate();
  const sessionState = useSession(session);
  const user = sessionState.user;
  const offlineSession = sessionState.offline === true;
  const expected = useExpectedCount();
  const guard = user?.fullName ?? user?.phone ?? '';

  return (
    <SafeAreaView style={gateStyles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={styles.gateName}>
              {gate?.name}
            </Text>
            <Text style={styles.estate}>{estateName}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sec.home.settings')}
            onPress={() => router.push('/settings')}
            style={styles.settings}
          >
            <Icon name="settings-outline" size={30} color={colors.brand.primary} />
          </Pressable>
        </View>

        <SosBanner />
        <ShiftBanner />
        {offlineSession ? (
          <View style={styles.offline} accessibilityLiveRegion="polite">
            <BodyText>{t('sec.offlineSession')}</BodyText>
          </View>
        ) : null}
        {!sync.online ? (
          <View style={styles.offline} accessibilityLiveRegion="polite">
            <BodyText>{t('sec.offlineNote')}</BodyText>
          </View>
        ) : null}
        {sync.rejected > 0 ? (
          <Pressable accessibilityRole="button" onPress={sync.clearRejected} style={styles.offline}>
            <BodyText>{t('sec.status.rejected', { count: sync.rejected })}</BodyText>
            <Text style={styles.dismiss}>{t('sec.status.dismiss')}</Text>
          </Pressable>
        ) : null}

        <View style={styles.grid}>
          <GateTile
            label={t('sec.home.scan')}
            icon="qr-code-outline"
            primary
            wide
            onPress={() => router.push('/scan')}
          />
          <GateTile
            label={t('sec.home.pin')}
            icon="keypad-outline"
            onPress={() => router.push('/pin')}
          />
          <GateTile
            label={t('sec.home.walkin')}
            icon="person-add-outline"
            onPress={() => router.push('/walkin/new')}
          />
          <GateTile
            label={t('sec.home.expected')}
            icon="calendar-outline"
            badge={expected}
            onPress={() => router.push('/expected')}
          />
          <GateTile
            label={t('sec.home.inside')}
            icon="people-outline"
            onPress={() => router.push('/inside')}
          />
          <GateTile
            label={t('sec.home.vehicle')}
            icon="car-outline"
            onPress={() => router.push('/vehicle')}
          />
          {can('incident.report') || can('incident.manage') ? (
            <GateTile
              label={t('sec.home.incident')}
              icon="document-text-outline"
              onPress={() => router.push('/incidents')}
            />
          ) : null}
          {can('sos.respond') ? (
            <GateTile
              label={t('sec.home.sos')}
              icon="alert-circle-outline"
              onPress={() => router.push('/sos')}
            />
          ) : null}
        </View>

        {can('sos.trigger') ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sec.home.raiseSos')}
            onPress={() => router.push('/sos/new')}
            style={({ pressed }) => [styles.raise, pressed && { opacity: 0.85 }]}
          >
            <Icon name="megaphone-outline" size={28} color={colors.neutral[0]} />
            <Text style={styles.raiseText}>{t('sec.home.raiseSos')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <StatusBar
        online={sync.online}
        pending={sync.pendingCount}
        guard={
          sync.lastSyncAt && sync.online
            ? `${guard} · ${t('sec.status.synced', { time: formatTime(sync.lastSyncAt) })}`
            : guard
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  gateName: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  estate: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  settings: {
    width: touchTarget.security,
    height: touchTarget.security,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  shift: {
    minHeight: touchTarget.security,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.brand.primary,
    backgroundColor: colors.neutral[0],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
  },
  shiftNone: { backgroundColor: colors.brand.primary },
  shiftText: {
    flex: 1,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  sos: {
    minHeight: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.status.danger,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
  },
  sosText: {
    flex: 1,
    color: colors.neutral[0],
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  offline: {
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.status.warning,
    backgroundColor: colors.neutral[0],
    padding: spacing[3],
    gap: spacing[2],
  },
  dismiss: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.brand.primary,
  },
  raise: {
    minHeight: touchTarget.security + 8,
    borderRadius: radii.lg,
    backgroundColor: colors.semantic.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  raiseText: {
    color: colors.neutral[0],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
});
