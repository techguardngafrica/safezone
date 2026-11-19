import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BackRow,
  BigButton,
  BodyText,
  Fact,
  gateStyles,
  GateTitle,
} from '../../src/components/gate-ui';
import { Icon, type IconName } from '../../src/components/icon';
import { errorText } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Waiting for the household (default 3 minute countdown), then record the outcome in one tap. */
export default function WalkinStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, sync } = useGate();
  const walkin = useQuery({
    queryKey: ['estate', estateId, 'walkin', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/walkins/{id}', { params: { path: { estateId, id } } }),
      ),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
  const pending = walkin.data?.status === 'pending';
  const now = useNow(pending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (walkin.isPending)
    return (
      <SafeAreaView style={gateStyles.screen}>
        <View style={gateStyles.content}>
          <Skeleton height={40} width="70%" />
          <Skeleton height={160} />
        </View>
      </SafeAreaView>
    );
  if (walkin.isError)
    return (
      <SafeAreaView style={[gateStyles.screen, { justifyContent: 'center', padding: spacing[4] }]}>
        <ErrorState message={errorText(walkin.error)} onRetry={() => void walkin.refetch()} />
      </SafeAreaView>
    );

  const request = walkin.data;
  const left = Math.max(0, Math.floor((new Date(request.expiresAt).getTime() - now) / 1000));
  const expired = request.status === 'timed_out' || (pending && left === 0);
  const state: 'waiting' | 'approved' | 'rejected' | 'timed_out' | 'cancelled' = expired
    ? 'timed_out'
    : request.status === 'pending'
      ? 'waiting'
      : request.status;

  const look: Record<typeof state, { icon: IconName; color: string; title: string }> = {
    waiting: { icon: 'time-outline', color: colors.brand.primary, title: t('sec.walkin.waiting') },
    approved: {
      icon: 'checkmark-circle',
      color: colors.gate.allow,
      title: t('sec.walkin.approved'),
    },
    rejected: { icon: 'close-circle', color: colors.gate.deny, title: t('sec.walkin.rejected') },
    timed_out: { icon: 'warning', color: colors.gate.check, title: t('sec.walkin.timedOut') },
    cancelled: {
      icon: 'close-circle',
      color: colors.semantic.textMuted,
      title: t('sec.walkin.cancelled'),
    },
  };
  const current = look[state];

  const record = async (decision: 'allow' | 'deny', reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await sync.record({
        direction: 'in',
        walkinId: request.id,
        visitorName: request.visitorName,
        vehiclePlate: request.vehiclePlate ?? undefined,
        decision,
        reason,
      });
      const message = decision === 'allow' ? t('sec.result.recorded') : t('sec.result.denied');
      setDone(outcome.queued ? `${message} ${t('sec.result.queued')}` : message);
      setTimeout(() => router.dismissTo('/'), 2000);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const askAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await unwrap(
        api.POST('/v1/estates/{estateId}/walkins', {
          params: { path: { estateId } },
          body: {
            gateId: request.gateId,
            spaceId: request.spaceId,
            visitorName: request.visitorName,
            ...(request.purpose ? { purpose: request.purpose } : {}),
            ...(request.vehiclePlate ? { vehiclePlate: request.vehiclePlate } : {}),
          },
        }),
      );
      router.replace(`/walkin/${next.id}`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, '0');

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <BackRow onBack={() => router.dismissTo('/')} />
        <View
          style={[styles.status, { borderColor: current.color }]}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            state === 'waiting'
              ? `${current.title}. ${t('sec.walkin.timeLeft', { minutes, seconds })}`
              : current.title
          }
        >
          <Icon name={current.icon} size={56} color={current.color} />
          <GateTitle>{current.title}</GateTitle>
          {state === 'waiting' ? (
            <Text style={styles.countdown}>{t('sec.walkin.timeLeft', { minutes, seconds })}</Text>
          ) : null}
        </View>

        <Fact label={t('sec.walkin.name')} value={request.visitorName} />
        {request.unitCode ? <Fact label={t('sec.result.host')} value={request.unitCode} /> : null}
        {request.purpose ? <Fact label={t('sec.walkin.purpose')} value={request.purpose} /> : null}
        {request.vehiclePlate ? (
          <Fact label={t('sec.result.vehicle')} value={request.vehiclePlate} />
        ) : null}

        {state === 'timed_out' ? <BodyText>{t('sec.walkin.timedOutBody')}</BodyText> : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {done ? (
          <View accessibilityLiveRegion="polite" style={{ gap: spacing[3] }}>
            <BodyText>{done}</BodyText>
            <BigButton label={t('sec.result.done')} onPress={() => router.dismissTo('/')} />
          </View>
        ) : state === 'approved' ? (
          <BigButton
            label={t('sec.result.recordEntry')}
            icon="enter-outline"
            busy={busy}
            onPress={() => void record('allow')}
          />
        ) : state === 'rejected' ? (
          <BigButton
            label={t('sec.result.deny')}
            tone="danger"
            icon="close-circle-outline"
            busy={busy}
            onPress={() => void record('deny', t('sec.walkin.denyReason'))}
          />
        ) : state === 'timed_out' ? (
          <>
            <BigButton
              label={t('sec.walkin.askAgain')}
              icon="refresh-outline"
              busy={busy}
              disabled={!sync.online}
              onPress={() => void askAgain()}
            />
            <BigButton
              label={t('sec.result.deny')}
              tone="danger"
              icon="close-circle-outline"
              disabled={busy}
              onPress={() => void record('deny', t('sec.walkin.noAnswerReason'))}
            />
          </>
        ) : state === 'cancelled' ? (
          <BigButton
            label={t('sec.sos.back')}
            tone="outline"
            onPress={() => router.dismissTo('/')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  status: {
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[5],
    borderRadius: radii.lg,
    borderWidth: 3,
    backgroundColor: colors.neutral[0],
  },
  countdown: {
    fontSize: typography.size.display,
    fontWeight: typography.weight.bold,
    fontFamily: 'monospace',
    color: colors.semantic.text,
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
