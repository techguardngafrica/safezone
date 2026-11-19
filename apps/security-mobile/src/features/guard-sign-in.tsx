import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton, BodyText, gateStyles, GateTitle, PinPad } from '../components/gate-ui';
import { Icon } from '../components/icon';
import type { GateDeviceInfo } from '../lib/device';
import { errorText } from '../lib/errors';
import { session } from '../lib/session';
import { type GateGuard, signInGuard, useGuardList } from './guard-auth';

/** PIN entry for one guard; used by sign-in and the idle lock. */
export function GuardPinEntry({
  device,
  guard,
  onDone,
  onBack,
  backLabel,
  title,
  replacesSession,
}: {
  device: GateDeviceInfo;
  guard: GateGuard;
  onDone?: () => void;
  onBack: () => void;
  backLabel: string;
  title?: string;
  /** Idle unlock: end the current session once the new one exists. */
  replacesSession?: boolean;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (value: string) => {
    setBusy(true);
    setMessage(null);
    // Let the "Checking PIN" text paint before the offline check takes the CPU.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const previous = replacesSession ? await session.getAccessToken() : null;
    const outcome = await signInGuard(device, guard, value, previous);
    setBusy(false);
    setPin('');
    if (outcome.kind === 'failed') setMessage(outcome.message);
    else onDone?.();
  };

  return (
    <View style={{ gap: spacing[4] }}>
      <GateTitle>{title ?? t('sec.guard.pinFor', { name: guard.displayName })}</GateTitle>
      <PinPad
        value={pin}
        onChange={(value) => {
          if (busy) return;
          setPin(value);
          if (value.length === 6) void submit(value);
        }}
      />
      {busy ? (
        <View accessibilityLiveRegion="polite">
          <BodyText>{t('sec.guard.checking')}</BodyText>
        </View>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="assertive" style={styles.error}>
          {message}
        </Text>
      ) : null}
      <BigButton label={backLabel} tone="outline" disabled={busy} onPress={onBack} />
    </View>
  );
}

/**
 * Shared gate phone sign-in (ADR-0017): pick your name, enter your PIN. Phone sign-in stays available
 * (supervisors, and guards setting their first PIN).
 */
export function GuardSignIn({
  device,
  onPhoneSignIn,
}: {
  device: GateDeviceInfo;
  onPhoneSignIn: () => void;
}) {
  const guards = useGuardList(device);
  const [chosen, setChosen] = useState<GateGuard | null>(null);

  if (chosen?.pinSet && !chosen.locked)
    return (
      <SafeAreaView style={gateStyles.screen}>
        <ScrollView contentContainerStyle={gateStyles.content}>
          <GuardPinEntry
            device={device}
            guard={chosen}
            onBack={() => setChosen(null)}
            backLabel={t('sec.guard.choose')}
          />
        </ScrollView>
      </SafeAreaView>
    );

  const data = guards.data?.list;
  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <GateTitle>{t('sec.guard.title')}</GateTitle>
        <BodyText muted>
          {t('sec.guard.subtitle', {
            gate: data?.gate.name ?? device.gateName,
            estate: data?.estate.name ?? device.estateName,
          })}
        </BodyText>
        {guards.data?.offline ? <BodyText>{t('sec.guard.offlineList')}</BodyText> : null}
        {chosen ? (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <BodyText>
              {chosen.locked
                ? t('sec.guard.lockedBody', { name: chosen.displayName })
                : t('sec.guard.noPinBody', { name: chosen.displayName })}
            </BodyText>
          </View>
        ) : null}
        {guards.isPending ? (
          <>
            <Skeleton height={72} />
            <Skeleton height={72} />
          </>
        ) : guards.isError ? (
          <ErrorState message={errorText(guards.error)} onRetry={() => void guards.refetch()} />
        ) : (
          (data?.guards ?? []).map((guard) => {
            const note = guard.locked
              ? t('sec.guard.locked')
              : !guard.pinSet
                ? t('sec.guard.noPin')
                : null;
            return (
              <Pressable
                key={guard.userId}
                accessibilityRole="button"
                accessibilityLabel={note ? `${guard.displayName}, ${note}` : guard.displayName}
                onPress={() => setChosen(guard)}
                style={({ pressed }) => [styles.guard, pressed && { opacity: 0.8 }]}
              >
                <Icon name="person-circle-outline" size={36} color={colors.brand.primary} />
                <Text style={styles.name}>{guard.displayName}</Text>
                {note ? <Text style={styles.note}>{note}</Text> : null}
              </Pressable>
            );
          })
        )}
        <BodyText muted>{t('sec.guard.notOnList')}</BodyText>
        <BigButton label={t('sec.guard.phoneSignIn')} tone="outline" onPress={onPhoneSignIn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  guard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  name: {
    flex: 1,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  note: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.status.warning,
  },
  notice: {
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.status.warning,
    padding: spacing[3],
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
