import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDateTime, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { BOOKING_TONE, bookingStatusLabel, isUpcomingBooking } from '../../src/features/facilities';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

export default function BookingsScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const bookings = useQuery({
    queryKey: ['estate', estateId, 'bookings', 'mine'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/bookings', {
          params: { path: { estateId }, query: { mine: 'true' } },
        }),
      ),
  });
  const pull = usePullRefresh(bookings.refetch);
  const all = bookings.data ?? [];
  const shown = all
    .filter((booking) =>
      view === 'upcoming' ? isUpcomingBooking(booking) : !isUpcomingBooking(booking),
    )
    .sort((a, b) =>
      view === 'upcoming'
        ? a.startsAt.localeCompare(b.startsAt)
        : b.startsAt.localeCompare(a.startsAt),
    );

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.booking.mine')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <ActionButton
        label={t('res.booking.new')}
        icon={<Icon name="add" color="#FFFFFF" size={20} />}
        onPress={() => router.push('/facilities')}
      />
      <Segmented
        label={t('res.booking.mine')}
        value={view}
        onChange={setView}
        options={[
          { key: 'upcoming', label: t('res.visitors.upcoming') },
          { key: 'past', label: t('res.visitors.past') },
        ]}
      />
      {bookings.isPending ? <Skeleton height={88} /> : null}
      {bookings.isError ? (
        <ErrorState message={errorText(bookings.error)} onRetry={() => void bookings.refetch()} />
      ) : null}
      {bookings.data && shown.length === 0 ? (
        <EmptyState
          icon={<Icon name="calendar-outline" size={28} color={colors.brand.primary} />}
          title={view === 'upcoming' ? t('res.booking.emptyUpcoming') : t('res.booking.emptyPast')}
        />
      ) : null}
      {shown.map((booking) => (
        <Card
          key={booking.id}
          onPress={() => router.push(`/bookings/${booking.id}`)}
          accessibilityLabel={`${booking.facilityName}, ${bookingStatusLabel(booking.status)}`}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text
              style={{
                fontSize: typography.size.md,
                fontWeight: '600',
                color: colors.semantic.text,
                flex: 1,
              }}
            >
              {booking.facilityName}
            </Text>
            <StatusPill
              tone={BOOKING_TONE[booking.status]}
              label={bookingStatusLabel(booking.status)}
            />
          </View>
          <Text style={{ color: colors.semantic.text, fontSize: typography.size.sm }}>
            {t('res.booking.when', {
              start: formatDateTime(booking.startsAt),
              end: formatTime(booking.endsAt).slice(0, 5),
            })}
          </Text>
        </Card>
      ))}
    </ScrollScreen>
  );
}
