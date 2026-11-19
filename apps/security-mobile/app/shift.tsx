import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, formatTime, t } from '@safezone/i18n';
import { ErrorState, ScrollScreen, Skeleton, TextField } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BackRow, BigButton, BodyText, GateTitle } from '../src/components/gate-ui';
import { useCurrentShift } from '../src/features/shift';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api, session } from '../src/lib/session';

/**
 * Shift start and end (security-mobile.md §7.8): the next guard reads the last handover, open incidents
 * and who is inside; the guard ending a shift writes a handover note and sees what is still open.
 */
export default function ShiftScreen() {
  const { estateId, gate, gates, sync } = useGate();
  const queryClient = useQueryClient();
  const current = useCurrentShift();
  const inside = useQuery({
    queryKey: ['estate', estateId, 'gate', 'inside'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gate/inside', { params: { path: { estateId } } })),
  });
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'shift', 'current'] });

  const start = async () => {
    if (!gate) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/estates/{estateId}/shift-sessions/start', {
          params: { path: { estateId } },
          body: { gateId: gate.id },
        }),
      );
      await refresh();
      router.back();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const end = async (shiftId: string) => {
    if (note.trim().length < 3) {
      setNoteError(t('sec.shift.handoverRequired'));
      return;
    }
    setNoteError(null);
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/estates/{estateId}/shift-sessions/{id}/end', {
          params: { path: { estateId, id: shiftId } },
          body: { handoverNote: note.trim() },
        }),
      );
      setEnded(true);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <>
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.shift.title')}</GateTitle>
    </>
  );

  if (ended)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <View accessibilityLiveRegion="polite">
          <BodyText>{t('sec.shift.ended')}</BodyText>
        </View>
        <BigButton
          label={t('sec.shift.signOut')}
          icon="log-out-outline"
          onPress={() => void session.signOut()}
        />
        <BigButton label={t('sec.sos.back')} tone="outline" onPress={() => router.back()} />
      </ScrollScreen>
    );

  if (current.isPending)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <Skeleton height={120} />
        <Skeleton height={64} />
      </ScrollScreen>
    );

  if (current.isError)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        {isNetworkError(current.error) || !sync.online ? (
          <BodyText>{t('sec.shift.offline')}</BodyText>
        ) : (
          <ErrorState message={errorText(current.error)} onRetry={() => void current.refetch()} />
        )}
      </ScrollScreen>
    );

  const { mine, previous, openIncidents } = current.data;
  const insideCount = inside.data?.length;
  const otherGateName = mine
    ? (gates.find((item) => item.id === mine.gateId)?.name ?? mine.gateName ?? '')
    : '';
  const counts = (
    <View style={styles.card}>
      <BodyText>{t('sec.shift.openIncidents', { count: openIncidents })}</BodyText>
      {insideCount !== undefined ? (
        <BodyText>{t('sec.shift.inside', { count: insideCount })}</BodyText>
      ) : null}
      <BodyText>{t('sec.shift.pending', { count: sync.pendingCount })}</BodyText>
    </View>
  );

  if (!mine)
    return (
      <ScrollScreen
        edges={['top', 'left', 'right', 'bottom']}
        footer={
          <BigButton
            label={t('sec.shift.start')}
            icon="play-outline"
            busy={busy}
            disabled={!sync.online}
            onPress={() => void start()}
          />
        }
      >
        {header}
        <Text accessibilityRole="header" style={styles.section}>
          {t('sec.shift.previous')}
        </Text>
        {previous ? (
          <View style={styles.card}>
            <BodyText muted>
              {t('sec.shift.previousBy', { time: formatDateTime(previous.endedAt) })}
            </BodyText>
            <Text style={styles.note}>{previous.handoverNote}</Text>
          </View>
        ) : (
          <BodyText muted>{t('sec.shift.noPrevious')}</BodyText>
        )}
        {counts}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollScreen>
    );

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <BigButton
          label={t('sec.shift.end')}
          icon="stop-outline"
          tone="danger"
          busy={busy}
          disabled={!sync.online}
          onPress={() => void end(mine.id)}
        />
      }
    >
      {header}
      <BodyText>
        {mine.gateId === gate?.id
          ? t('sec.shift.onShift', { gate: gate.name, time: formatTime(mine.startedAt) })
          : t('sec.shift.otherGate', { gate: otherGateName })}
      </BodyText>
      <Text accessibilityRole="header" style={styles.section}>
        {t('sec.shift.unresolved')}
      </Text>
      {counts}
      <Text accessibilityRole="header" style={styles.section}>
        {t('sec.shift.handoverTitle')}
      </Text>
      <BodyText muted>{t('sec.shift.handoverBody')}</BodyText>
      <TextField
        label={t('sec.shift.handoverLabel')}
        value={note}
        onChangeText={setNote}
        placeholder={t('sec.shift.handoverPlaceholder')}
        multiline
        maxLength={4000}
        error={noteError}
      />
      {!sync.online ? <BodyText>{t('sec.shift.offline')}</BodyText> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  card: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  note: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
