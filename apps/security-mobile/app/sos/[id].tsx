import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatElapsed, formatTime, t } from '@safezone/i18n';
import { ConfirmModal, ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton } from '../../src/components/gate-ui';
import { Icon } from '../../src/components/icon';
import { ACTIVE_SOS, categoryText, eventText, SOS_POLL_MS } from '../../src/features/sos';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

type Action = 'acknowledge' | 'responding';
type Dialog = 'note' | 'resolve' | 'false' | null;

function mapsUrl(lat: number, lng: number): string {
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}`;
}

/**
 * Full-screen SOS alarm and response (security-mobile.md §7.6, UI_GUIDELINES §8.4). Danger red is
 * reserved for this screen and DENY. No ads.
 */
export default function SosAlarm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, sync } = useGate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['estate', estateId, 'sos', id],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/sos/{id}', { params: { path: { estateId, id } } })),
    refetchInterval: SOS_POLL_MS,
  });
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos', id] }),
      queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos', 'active'] }),
    ]);
  };

  const act = async (action: Action) => {
    setBusy(action);
    setError(null);
    try {
      if (action === 'acknowledge')
        await unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/acknowledge', {
            params: { path: { estateId, id } },
          }),
        );
      else
        await unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/responding', {
            params: { path: { estateId, id } },
          }),
        );
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitDialog = async () => {
    setBusy(dialog);
    setError(null);
    try {
      if (dialog === 'note')
        await unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/notes', {
            params: { path: { estateId, id } },
            body: { note: text.trim() },
          }),
        );
      else
        await unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/resolve', {
            params: { path: { estateId, id } },
            body: { resolution: text.trim(), falseAlarm: dialog === 'false' },
          }),
        );
      setDialog(null);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  if (detail.isPending)
    return (
      <SafeAreaView style={[styles.screen, { padding: spacing[4], gap: spacing[3] }]}>
        <Skeleton height={64} />
        <Skeleton height={160} />
      </SafeAreaView>
    );
  if (detail.isError)
    return (
      <SafeAreaView style={[styles.screen, { padding: spacing[4], justifyContent: 'center' }]}>
        <View style={styles.panel}>
          {isNetworkError(detail.error) || !sync.online ? (
            <Text style={styles.panelText}>{t('sec.sos.offline')}</Text>
          ) : (
            <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
          )}
        </View>
        <BigButton label={t('sec.sos.back')} tone="light" onPress={() => router.back()} />
      </SafeAreaView>
    );

  const alert = detail.data;
  const active = ACTIVE_SOS.has(alert.status);
  const location = alert.lastLocation;

  return (
    <SafeAreaView style={[styles.screen, !active && { backgroundColor: colors.semantic.text }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`${t('sec.sos.alarm')}. ${categoryText(alert.category)}. ${
            alert.unitCode ? t('sec.sos.unit', { unit: alert.unitCode }) : t('sec.sos.noUnit')
          }`}
          style={styles.head}
        >
          <Icon name="warning" size={64} color={colors.neutral[0]} />
          <Text style={styles.word}>
            {alert.isDrill ? `${t('sec.sos.drill')} ` : ''}
            {t('sec.sos.alarm')}
          </Text>
          <Text style={styles.category}>{categoryText(alert.category)}</Text>
          <Text style={styles.unit}>
            {alert.unitCode ? t('sec.sos.unit', { unit: alert.unitCode }) : t('sec.sos.noUnit')}
          </Text>
          <Text style={styles.meta}>
            {t('sec.sos.ago', { time: formatElapsed(alert.triggeredAt, now) })} ·{' '}
            {t(`sos.status.${alert.status}`)}
          </Text>
        </View>

        {!active ? <Text style={styles.meta}>{t('sec.sos.ended')}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {active ? (
          <View style={{ gap: spacing[3] }}>
            {alert.status === 'triggered' ? (
              <BigButton
                label={t('sec.sos.acknowledge')}
                tone="light"
                icon="hand-left-outline"
                busy={busy === 'acknowledge'}
                onPress={() => void act('acknowledge')}
              />
            ) : null}
            {alert.status !== 'responding' ? (
              <BigButton
                label={t('sec.sos.onMyWay')}
                tone={alert.status === 'triggered' ? 'ghostLight' : 'light'}
                icon="walk-outline"
                busy={busy === 'responding'}
                onPress={() => void act('responding')}
              />
            ) : null}
            {location ? (
              <BigButton
                label={t('sec.sos.location')}
                tone="ghostLight"
                icon="location-outline"
                onPress={() => void Linking.openURL(mapsUrl(location.lat, location.lng))}
              />
            ) : (
              <Text style={styles.meta}>{t('sec.sos.noLocation')}</Text>
            )}
            {location ? (
              <Text style={styles.meta}>
                {t('sec.sos.locationAt', { time: formatTime(location.capturedAt) })}
              </Text>
            ) : null}
            {(alert.emergencyContacts ?? []).map((contact) => (
              <BigButton
                key={`${contact.name}${contact.phone}`}
                label={t('sec.sos.callContact', {
                  name: contact.name,
                  relationship: contact.relationship,
                })}
                tone="ghostLight"
                icon="call-outline"
                onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
              />
            ))}
            <BigButton
              label={t('sec.sos.addNote')}
              tone="ghostLight"
              icon="create-outline"
              onPress={() => {
                setText('');
                setDialog('note');
              }}
            />
            <BigButton
              label={t('sec.sos.resolve')}
              tone="light"
              icon="checkmark-done-outline"
              onPress={() => {
                setText('');
                setDialog('resolve');
              }}
            />
            <BigButton
              label={t('sec.sos.falseAlarm')}
              tone="ghostLight"
              icon="close-outline"
              onPress={() => {
                setText('');
                setDialog('false');
              }}
            />
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t('sec.sos.timeline')}</Text>
          {alert.timeline
            .slice()
            .reverse()
            .map((event) => (
              <View key={event.id} style={styles.event}>
                <Text style={styles.eventTime}>{formatTime(event.occurredAt)}</Text>
                <Text style={styles.panelText}>
                  {eventText(event.type)}
                  {typeof event.payload.note === 'string' ? `: ${event.payload.note}` : ''}
                </Text>
              </View>
            ))}
        </View>

        <BigButton label={t('sec.sos.back')} tone="ghostLight" onPress={() => router.back()} />
      </ScrollView>

      <ConfirmModal
        visible={dialog !== null}
        title={
          dialog === 'note'
            ? t('sec.sos.noteTitle')
            : dialog === 'false'
              ? t('sec.sos.falseTitle')
              : t('sec.sos.resolveTitle')
        }
        body={
          dialog === 'note'
            ? t('sec.sos.noteBody')
            : dialog === 'false'
              ? t('sec.sos.falseBody')
              : t('sec.sos.resolveBody')
        }
        confirmLabel={
          dialog === 'note'
            ? t('sec.sos.noteSave')
            : dialog === 'false'
              ? t('sec.sos.falseAlarm')
              : t('sec.sos.resolve')
        }
        busy={busy === dialog}
        error={error}
        reason={{
          label: dialog === 'note' ? t('sec.sos.noteLabel') : t('sec.sos.resolutionLabel'),
          value: text,
          onChange: setText,
          required: true,
        }}
        onConfirm={() => {
          if (dialog !== 'note' && text.trim().length < 3) return;
          void submitDialog();
        }}
        onCancel={() => setDialog(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.status.danger },
  body: { padding: spacing[4], gap: spacing[4] },
  head: { alignItems: 'center', gap: spacing[1], paddingTop: spacing[3] },
  word: {
    color: colors.neutral[0],
    fontSize: 48,
    fontWeight: typography.weight.bold,
    letterSpacing: 2,
  },
  category: {
    color: colors.neutral[0],
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
  },
  unit: {
    color: colors.neutral[0],
    fontSize: typography.size.xl,
    fontWeight: typography.weight.semibold,
  },
  meta: {
    color: colors.neutral[0],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
    textAlign: 'center',
  },
  error: {
    color: colors.neutral[0],
    backgroundColor: colors.semantic.text,
    padding: spacing[3],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  panel: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.neutral[0],
  },
  panelTitle: {
    color: colors.neutral[0],
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  panelText: {
    flex: 1,
    color: colors.neutral[0],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
  },
  event: { flexDirection: 'row', gap: spacing[3] },
  eventTime: {
    color: colors.neutral[0],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    fontFamily: 'monospace',
  },
});
