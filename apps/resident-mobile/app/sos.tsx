import { type ApiData, unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatTime, type MessageKey, t } from '@safezone/i18n';
import { ActionButton, Card, ConfirmModal, StatusPill, type Tone } from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../src/components/icon';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useResident } from '../src/lib/resident';
import { api } from '../src/lib/session';

type Alert = ApiData<'/v1/estates/{estateId}/sos/{id}', 'get'>;
type Status = Alert['status'];
const ACTIVE: Status[] = ['triggered', 'acknowledged', 'assigned', 'responding'];
const TONE: Record<Status, Tone> = {
  triggered: 'danger',
  acknowledged: 'warning',
  assigned: 'info',
  responding: 'info',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};
const LOCATION_EVERY_MS = 30_000;

/** Shares location only while this alert is active (AGENTS §6 rule 6); stops on resolve or cancel. */
function useShareLocation(estateId: string, alertId: string | null, active: boolean) {
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!alertId || !active) {
      setSharing(false);
      return undefined;
    }
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const send = async () => {
      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (stopped) return;
        await api.POST('/v1/estates/{estateId}/sos/{id}/location', {
          params: { path: { estateId, id: alertId } },
          body: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: position.coords.accuracy ?? undefined,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        });
        setSharing(true);
      } catch {
        // Location is best effort; the alert itself is already with security.
      }
    };
    void Location.requestForegroundPermissionsAsync().then(({ granted }) => {
      if (!granted || stopped) return;
      void send();
      timer = setInterval(() => void send(), LOCATION_EVERY_MS);
    });
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [estateId, alertId, active]);
  return sharing;
}

function Timeline({ alert }: { alert: Alert }) {
  const steps: { key: string; label: string; at: string | null }[] = [
    { key: 'triggered', label: t('res.sos.step.sent'), at: alert.triggeredAt },
    { key: 'acknowledged', label: t('res.sos.step.acknowledged'), at: alert.acknowledgedAt },
    { key: 'responding', label: t('res.sos.step.responding'), at: alert.respondingAt },
    { key: 'resolved', label: t('res.sos.step.resolved'), at: alert.resolvedAt },
  ];
  return (
    <View style={{ gap: spacing[3] }}>
      {steps.map((step) => (
        <View key={step.key} style={styles.step}>
          <View style={[styles.dot, step.at ? styles.dotDone : null]}>
            {step.at ? <Icon name="checkmark" size={14} color="#FFFFFF" /> : null}
          </View>
          <Text style={[styles.stepText, !step.at && styles.stepPending]}>{step.label}</Text>
          <Text style={styles.stepTime}>{step.at ? formatTime(step.at) : ''}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * SOS: sends the alert the moment this screen opens (the alert is queued before any other work), shows a
 * cancel countdown on a full Danger panel, then live status (UI_GUIDELINES §9.1). No ads, no decoration.
 */
export default function SosScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ trigger?: string; key?: string; id?: string }>();
  const { estateId, household } = useResident();
  const [alertId, setAlertId] = useState<string | null>(params.id ?? null);
  const [countdown, setCountdown] = useState<number | null>(params.trigger ? 5 : null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const sentOnce = useRef(false);

  const trigger = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/sos', {
          params: { path: { estateId } },
          body: { category: 'general', householdId: household?.id },
          headers: { 'Idempotency-Key': params.key ?? '' },
        }),
      ),
    onSuccess: (alert) => {
      setAlertId(alert.id);
      queryClient.setQueryData(['estate', estateId, 'sos', 'detail', alert.id], alert);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos', 'active'] });
    },
  });

  useEffect(() => {
    if (params.trigger && !sentOnce.current) {
      sentOnce.current = true;
      trigger.mutate();
    }
  }, [params.trigger, trigger]);

  // The countdown length comes from estate policy; it starts at once and is corrected when settings load.
  const settings = useQuery({
    queryKey: ['estate', estateId, 'settings'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/settings', { params: { path: { estateId } } })),
    enabled: Boolean(params.trigger),
  });
  const policySeconds = settings.data?.['sos.cancel_countdown_seconds'];
  useEffect(() => {
    if (policySeconds === undefined) return;
    setCountdown((value) => (value === null ? null : Math.min(value, policySeconds)));
  }, [policySeconds]);
  useEffect(() => {
    if (countdown === null || countdown <= 0) return undefined;
    const timer = setTimeout(
      () => setCountdown((value) => (value === null ? null : value - 1)),
      1_000,
    );
    return () => clearTimeout(timer);
  }, [countdown]);

  const detail = useQuery({
    queryKey: ['estate', estateId, 'sos', 'detail', alertId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos/{id}', {
          params: { path: { estateId, id: alertId ?? '' } },
        }),
      ),
    enabled: Boolean(alertId),
    refetchInterval: 3_000,
  });
  const alert = detail.data;
  const active = alert ? ACTIVE.includes(alert.status) : Boolean(alertId);
  const sharing = useShareLocation(estateId, alertId, active);

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/sos/{id}/cancel', {
          params: { path: { estateId, id: alertId ?? '' } },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'sos', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos', 'active'] });
      setCountdown(null);
      setConfirmCancel(false);
    },
  });

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const inCountdown =
    countdown !== null && countdown > 0 && (!alert || alert.status === 'triggered');

  // Sending failed: keep the panel up with a retry (same idempotency key, so no duplicate alerts).
  if (trigger.isError && !alertId)
    return (
      <SafeAreaView style={[styles.flex, styles.danger]}>
        <ScrollView contentContainerStyle={styles.panel}>
          <Icon name="warning" size={56} color="#FFFFFF" />
          <Text style={styles.panelTitle}>{t('res.sos.failedTitle')}</Text>
          <Text style={styles.panelBody}>
            {isNetworkError(trigger.error) ? t('sos.smsFallback') : errorText(trigger.error)}
          </Text>
          <ActionButton
            label={t('res.sos.retry')}
            variant="secondary"
            large
            onPress={() => trigger.mutate()}
            busy={trigger.isPending}
          />
          <ActionButton label={t('res.sos.back')} variant="text" onPress={close} />
        </ScrollView>
      </SafeAreaView>
    );

  if (inCountdown)
    return (
      <SafeAreaView style={[styles.flex, styles.danger]}>
        <View style={styles.panel}>
          {alert?.isDrill ? <Text style={styles.drill}>{t('sos.drill')}</Text> : null}
          <Text style={styles.panelTitle} accessibilityLiveRegion="assertive">
            {trigger.isPending ? t('res.sos.sending') : t('sos.sent')}
          </Text>
          <Text style={styles.panelBody}>{t('res.sos.countdownBody')}</Text>
          <View style={styles.cancelWrap}>
            <ActionButton
              label={t('sos.cancel', { seconds: countdown ?? 0 })}
              variant="secondary"
              large
              busy={cancel.isPending}
              disabled={!alertId}
              onPress={() => cancel.mutate()}
            />
          </View>
          {cancel.isError ? <Text style={styles.panelBody}>{errorText(cancel.error)}</Text> : null}
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {alert?.isDrill ? (
          <Text style={[styles.drill, styles.drillLight]}>{t('sos.drill')}</Text>
        ) : null}
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {active ? t('res.sos.liveTitle') : t('res.sos.endedTitle')}
          </Text>
          {alert ? (
            <StatusPill
              tone={TONE[alert.status]}
              label={t(`sos.status.${alert.status}` as MessageKey)}
              icon={<Icon name="alert-circle" size={14} color={colors.semantic.text} />}
            />
          ) : null}
        </View>
        {active ? <Text style={styles.body}>{t('res.sos.liveBody')}</Text> : null}
        {sharing && active ? (
          <View style={styles.locationRow} accessibilityLiveRegion="polite">
            <Icon name="location" size={16} color={colors.status.danger} />
            <Text style={styles.locationText}>{t('res.sos.sharingLocation')}</Text>
          </View>
        ) : null}
        <Card>{alert ? <Timeline alert={alert} /> : <Text>{t('common.loading')}</Text>}</Card>
        {alert?.resolution ? (
          <Card>
            <Text style={styles.body}>{alert.resolution}</Text>
          </Card>
        ) : null}
        {alert?.status === 'triggered' ? (
          <ActionButton
            label={t('res.sos.imSafe')}
            variant="outline"
            onPress={() => setConfirmCancel(true)}
          />
        ) : null}
        <ActionButton
          label={active ? t('res.sos.backToApp') : t('res.sos.done')}
          variant={active ? 'text' : 'primary'}
          onPress={close}
        />
      </ScrollView>
      <ConfirmModal
        visible={confirmCancel}
        title={t('res.sos.cancelTitle')}
        body={t('res.sos.cancelBody')}
        confirmLabel={t('res.sos.cancelConfirm')}
        cancelLabel={t('res.sos.keepAlert')}
        busy={cancel.isPending}
        error={cancel.isError ? errorText(cancel.error) : null}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.semantic.background },
  danger: { backgroundColor: colors.status.danger },
  panel: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    padding: spacing[5],
    gap: spacing[4],
  },
  panelTitle: {
    color: '#FFFFFF',
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    textAlign: 'center',
  },
  panelBody: { color: '#FFFFFF', fontSize: typography.size.md, textAlign: 'center' },
  cancelWrap: { marginTop: spacing[5] },
  drill: {
    alignSelf: 'center',
    color: colors.statusSubtle.warning.text,
    backgroundColor: colors.statusSubtle.warning.background,
    fontWeight: typography.weight.bold,
    letterSpacing: 2,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
    borderRadius: radii.sm,
  },
  drillLight: { alignSelf: 'stretch', textAlign: 'center' },
  scroll: { padding: spacing[4], gap: spacing[4] },
  header: { gap: spacing[2] },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  body: { fontSize: typography.size.md, color: colors.semantic.text },
  locationRow: { flexDirection: 'row', gap: spacing[1], alignItems: 'center' },
  locationText: {
    color: colors.status.danger,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: 32 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  stepText: { flex: 1, fontSize: typography.size.md, color: colors.semantic.text },
  stepPending: { color: colors.semantic.textMuted },
  stepTime: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
});
