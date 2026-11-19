import { type ApiRow, newIdempotencyKey, unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatTime, t } from '@safezone/i18n';
import { EmptyState, ErrorState, Skeleton, TextField } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BigButton, BodyText, gateStyles, GateTitle } from '../src/components/gate-ui';
import { Icon } from '../src/components/icon';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api } from '../src/lib/session';

type EventPass = ApiRow<'/v1/estates/{estateId}/gate/event-passes', 'get'>;
type Guest = EventPass['guests'][number];

/**
 * Event guest lists (security-mobile.md §7.4): each event pass for this gate with its guests; a guard
 * finds a guest by name and checks them in once, which records the entry against the event pass.
 */
export default function EventsScreen() {
  const { estateId, gate, sync } = useGate();
  const { passId } = useLocalSearchParams<{ passId?: string }>();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ['estate', estateId, 'gate', 'event-passes', gate?.id];
  const events = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/gate/event-passes', {
          params: { path: { estateId }, query: { gateId: gate?.id ?? '' } },
        }),
      ),
    enabled: Boolean(gate),
    refetchInterval: 60_000,
  });

  const checkIn = async (guest: Guest) => {
    if (!gate) return;
    setBusyId(guest.id);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/estates/{estateId}/event-guests/{id}/check-in', {
          params: { path: { estateId, id: guest.id } },
          body: { gateId: gate.id, clientUuid: newIdempotencyKey() },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const list = (events.data ?? []).filter((event) => !passId || event.passId === passId);
  const q = query.trim().toLowerCase();

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content} keyboardShouldPersistTaps="handled">
        <BackRow onBack={() => router.back()} />
        <GateTitle>{t('sec.events.title')}</GateTitle>
        {!sync.online ? <BodyText>{t('sec.events.offline')}</BodyText> : null}
        <TextField
          label={t('sec.events.search')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="words"
        />
        {error ? (
          <Text accessibilityLiveRegion="assertive" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {events.isPending ? <Skeleton height={160} /> : null}
        {events.isError ? (
          isNetworkError(events.error) ? (
            <BodyText>{t('sec.events.offline')}</BodyText>
          ) : (
            <ErrorState message={errorText(events.error)} onRetry={() => void events.refetch()} />
          )
        ) : null}
        {events.data && list.length === 0 ? <EmptyState title={t('sec.events.empty')} /> : null}
        {list.map((event) => {
          const guests = event.guests.filter((guest) => !q || guest.name.toLowerCase().includes(q));
          const inCount = event.guests.filter((guest) => guest.checkedInAt).length;
          return (
            <View key={event.passId} style={styles.event}>
              <Text accessibilityRole="header" style={styles.eventName}>
                {event.eventName}
              </Text>
              <Text style={styles.meta}>
                {[
                  event.unitCode ? t('sec.events.host', { unit: event.unitCode }) : null,
                  t('sec.events.window', {
                    from: formatTime(event.validFrom),
                    to: formatTime(event.validTo),
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Text style={styles.count}>
                {t('sec.events.count', { in: inCount, total: event.guests.length })}
              </Text>
              {q && guests.length === 0 ? (
                <BodyText muted>{t('sec.events.noMatch', { query: query.trim() })}</BodyText>
              ) : null}
              {guests.map((guest) => (
                <View key={guest.id} style={styles.guest}>
                  <Text style={styles.guestName}>{guest.name}</Text>
                  {guest.checkedInAt ? (
                    <View style={styles.inRow}>
                      <Icon name="checkmark-circle" size={24} color={colors.gate.allow} />
                      <Text style={styles.inText}>
                        {t('sec.events.checkedIn', { time: formatTime(guest.checkedInAt) })}
                      </Text>
                    </View>
                  ) : (
                    <BigButton
                      label={t('sec.events.checkIn')}
                      icon="enter-outline"
                      busy={busyId === guest.id}
                      disabled={!sync.online || (busyId !== null && busyId !== guest.id)}
                      onPress={() => void checkIn(guest)}
                    />
                  )}
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  event: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  eventName: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  meta: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  count: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.brand.primary,
  },
  guest: {
    gap: spacing[2],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.semantic.borderSubtle,
  },
  guestName: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], minHeight: 56 },
  inText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.gate.allow,
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
