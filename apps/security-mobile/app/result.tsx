import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import { ConfirmModal } from '@safezone/mobile-ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton, Fact } from '../src/components/gate-ui';
import { Icon, type IconName } from '../src/components/icon';
import {
  clearVerification,
  passTypeText,
  reasonText,
  takeVerification,
} from '../src/features/verification';
import { errorText } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';

const LOOK: Record<'allow' | 'check' | 'deny', { fill: string; icon: IconName; word: string }> = {
  allow: { fill: colors.gate.allow, icon: 'checkmark-circle', word: t('gate.allow') },
  check: { fill: colors.gate.check, icon: 'warning', word: t('gate.check') },
  deny: { fill: colors.gate.deny, icon: 'close-circle', word: t('gate.deny') },
};

type Modal = 'override' | 'deny' | null;

/**
 * Full-screen ALLOW / CHECK / DENY (security-mobile.md §7.2, UI_GUIDELINES §8.4): icon plus word plus
 * colour, white text, and at most two taps to record.
 */
export default function ResultScreen() {
  const { sync } = useGate();
  const [verification] = useState(takeVerification);
  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => clearVerification, []);

  // After recording, go back to the gate on its own so the next visitor is not kept waiting.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.dismissTo('/'), 2500);
    return () => clearTimeout(timer);
  }, [done]);

  if (!verification)
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.neutral[0] }]}>
        <View style={styles.body}>
          <Text style={[styles.reason, { color: colors.semantic.text }]}>
            {t('sec.result.expired')}
          </Text>
          <BigButton label={t('sec.result.back')} onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );

  const { result, direction } = verification;
  const look = LOOK[result.decision];
  const pass = result.pass;

  const record = async (decision: 'allow' | 'check' | 'deny', why?: string) => {
    if (!pass) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await sync.record({
        direction,
        passId: pass.id,
        visitorName: pass.visitorName || undefined,
        vehiclePlate: pass.vehiclePlate ?? undefined,
        decision,
        reason: why?.trim() || undefined,
      });
      setModal(null);
      const message =
        decision === 'deny'
          ? t('sec.result.denied')
          : direction === 'out'
            ? t('sec.result.exitRecorded')
            : t('sec.result.recorded');
      setDone(outcome.queued ? `${message} ${t('sec.result.queued')}` : message);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: look.fill }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View
          style={styles.decision}
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`${look.word}. ${result.reasons.map(reasonText).join('. ')}`}
        >
          <Icon name={look.icon} size={88} color={colors.neutral[0]} />
          <Text style={styles.word}>{look.word}</Text>
        </View>

        {result.reasons.map((code) => (
          <Text key={code} style={styles.reason}>
            {reasonText(code)}
          </Text>
        ))}
        {result.offline ? <Text style={styles.note}>{t('sec.result.offline')}</Text> : null}

        {pass ? (
          <View style={styles.facts}>
            <Text style={styles.name}>{pass.visitorName || t('sec.result.unknownVisitor')}</Text>
            {pass.unitCode ? (
              <Fact light label={t('sec.result.host')} value={pass.unitCode} />
            ) : null}
            <Fact light label={t('sec.result.type')} value={passTypeText(pass.type)} />
            {pass.vehiclePlate ? (
              <Fact light label={t('sec.result.vehicle')} value={pass.vehiclePlate} />
            ) : null}
            <Fact
              light
              label={t('sec.result.usesLeft')}
              value={pass.usesLeft === null ? t('sec.result.unlimited') : String(pass.usesLeft)}
            />
            <Fact light label={t('sec.result.validTo')} value={formatDateTime(pass.validTo)} />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {done ? (
          <View style={{ gap: spacing[3] }} accessibilityLiveRegion="polite">
            <Text style={styles.reason}>{done}</Text>
            <BigButton
              label={t('sec.result.done')}
              tone="light"
              onPress={() => router.dismissTo('/')}
            />
          </View>
        ) : (
          <View style={{ gap: spacing[3] }}>
            {result.decision === 'allow' && pass ? (
              <BigButton
                label={
                  direction === 'out' ? t('sec.result.recordExit') : t('sec.result.recordEntry')
                }
                tone="light"
                icon={direction === 'out' ? 'exit-outline' : 'enter-outline'}
                busy={busy}
                onPress={() => void record('allow')}
              />
            ) : null}
            {result.decision === 'check' && pass ? (
              <>
                <BigButton
                  label={t('sec.result.recordWithReason')}
                  tone="light"
                  icon="enter-outline"
                  onPress={() => {
                    setReason('');
                    setModal('override');
                  }}
                />
                <BigButton
                  label={t('sec.result.deny')}
                  tone="ghostLight"
                  icon="close-circle-outline"
                  onPress={() => {
                    setReason('');
                    setModal('deny');
                  }}
                />
              </>
            ) : null}
            <BigButton
              label={t('sec.result.back')}
              tone={result.decision === 'deny' || !pass ? 'light' : 'ghostLight'}
              icon="scan-outline"
              onPress={() => router.back()}
            />
          </View>
        )}
      </ScrollView>

      <ConfirmModal
        visible={modal !== null}
        title={modal === 'deny' ? t('sec.result.denyTitle') : t('sec.result.overrideTitle')}
        body={modal === 'deny' ? t('sec.result.denyBody') : t('sec.result.overrideBody')}
        confirmLabel={modal === 'deny' ? t('sec.result.deny') : t('sec.result.recordEntry')}
        destructive={modal === 'deny'}
        busy={busy}
        error={error}
        reason={{
          label: modal === 'deny' ? t('sec.result.denyReasonLabel') : t('sec.result.reasonLabel'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => void record(modal === 'deny' ? 'deny' : 'check', reason)}
        onCancel={() => setModal(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: spacing[5], gap: spacing[4], flexGrow: 1, justifyContent: 'center' },
  decision: { alignItems: 'center', gap: spacing[2] },
  word: {
    color: colors.neutral[0],
    fontSize: 48,
    fontWeight: typography.weight.bold,
    letterSpacing: 2,
  },
  reason: {
    color: colors.neutral[0],
    fontSize: typography.size.xl,
    fontWeight: typography.weight.semibold,
    textAlign: 'center',
  },
  note: {
    color: colors.neutral[0],
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    textAlign: 'center',
  },
  facts: { gap: spacing[3] },
  name: {
    color: colors.neutral[0],
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
  },
  error: {
    color: colors.neutral[0],
    backgroundColor: colors.semantic.text,
    padding: spacing[3],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
