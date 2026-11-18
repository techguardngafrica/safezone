import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDate, formatKobo, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  bookableDates,
  bookingPrice,
  durationLabel,
  durationOptions,
  freeStartTimes,
  priceLabel,
} from '../../src/features/facilities';
import { errorText } from '../../src/lib/errors';
import { formErrors } from '../../src/lib/form-errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

function dateLabel(date: string, index: number): string {
  if (index === 0) return t('res.newPass.today');
  if (index === 1) return t('res.newPass.tomorrow');
  return formatDate(`${date}T12:00:00Z`);
}

/** Facility details and booking: pick a day, a length, a free start time, guests; the price is shown first. */
export default function FacilityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, can } = useResident();
  const [date, setDate] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [guests, setGuests] = useState('');
  const [purpose, setPurpose] = useState('');
  const [errors, setErrors] = useState<{ start?: string; guests?: string; purpose?: string }>({});

  const facility = useQuery({
    queryKey: ['estate', estateId, 'facility', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/facilities/{id}', { params: { path: { estateId, id } } }),
      ),
  });
  const data = facility.data;
  const dates = useMemo(() => (data ? bookableDates(data.policy.advanceDays) : []), [data]);
  const durations = useMemo(() => (data ? durationOptions(data.policy) : []), [data]);
  const chosenDate = date ?? dates[0] ?? null;
  const chosenMinutes = minutes ?? durations[0] ?? null;

  const availability = useQuery({
    queryKey: ['estate', estateId, 'facility', id, 'availability', chosenDate],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/facilities/{id}/availability', {
          params: { path: { estateId, id }, query: { date: chosenDate ?? '' } },
        }),
      ),
    enabled: Boolean(chosenDate),
  });
  const starts = useMemo(
    () =>
      availability.data && data && chosenMinutes
        ? freeStartTimes(availability.data, chosenMinutes, data.policy.bufferMinutes)
        : [],
    [availability.data, data, chosenMinutes],
  );
  const chosenStart = start && starts.includes(start) ? start : null;

  const book = useMutation({
    mutationFn: () => {
      const startsAt = chosenStart ?? '';
      const endsAt = new Date(
        new Date(startsAt).getTime() + (chosenMinutes ?? 0) * 60_000,
      ).toISOString();
      return unwrap(
        api.POST('/v1/estates/{estateId}/bookings', {
          params: { path: { estateId } },
          body: {
            facilityId: id,
            startsAt,
            endsAt,
            ...(guests.trim() ? { guests: Number(guests) } : {}),
            ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
          },
        }),
      );
    },
    onSuccess: (booking) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'bookings'] });
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'facility', id, 'availability'],
      });
      queryClient.setQueryData(['estate', estateId, 'booking', booking.id], booking);
      router.replace(`/bookings/${booking.id}`);
    },
    onError: (error) => {
      const server = formErrors(error, {
        guests: 'guests',
        purpose: 'purpose',
        startsAt: 'start',
        endsAt: 'start',
      } as const);
      setErrors(server.fields);
    },
  });

  const submit = () => {
    const found: typeof errors = {};
    if (!chosenStart) found.start = t('res.facility.pickTime');
    const maxGuests = data?.policy.maxGuests ?? 0;
    if (guests.trim()) {
      const count = Number(guests);
      if (!Number.isInteger(count) || count < 0) found.guests = t('res.facility.guestsInvalid');
      else if (maxGuests > 0 && count > maxGuests)
        found.guests = t('res.facility.guestsMax', { count: maxGuests });
    }
    setErrors(found);
    if (Object.keys(found).length === 0) book.mutate();
  };

  const price = data && chosenMinutes ? bookingPrice(data.pricing, chosenMinutes) : 0;
  const canBook = can('facility.book');

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        data && canBook ? (
          <>
            {chosenStart && chosenMinutes ? (
              <Text style={{ color: colors.semantic.text, fontSize: 14, marginBottom: 8 }}>
                {t('res.facility.summary', {
                  start: formatTime(chosenStart).slice(0, 5),
                  length: durationLabel(chosenMinutes),
                  price: price > 0 ? formatKobo(price) : t('res.facility.free'),
                })}
              </Text>
            ) : null}
            <ActionButton
              label={
                data.policy.requiresApproval ? t('res.facility.request') : t('res.facility.book')
              }
              onPress={submit}
              busy={book.isPending}
            />
          </>
        ) : undefined
      }
    >
      <ScreenHeader
        title={data?.name ?? t('res.facility.title')}
        subtitle={data ? priceLabel(data.pricing) : undefined}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {facility.isPending ? <Skeleton height={200} /> : null}
      {facility.isError ? (
        <ErrorState message={errorText(facility.error)} onRetry={() => void facility.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            {data.description ? (
              <Text style={{ color: colors.semantic.text, fontSize: typography.size.md }}>
                {data.description}
              </Text>
            ) : null}
            <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
              {t('res.facility.limits', {
                min: durationLabel(data.policy.minMinutes),
                max: durationLabel(data.policy.maxMinutes),
                days: data.policy.advanceDays,
              })}
            </Text>
            {data.policy.requiresApproval ? (
              <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
                {t('res.facility.needsApproval')}
              </Text>
            ) : null}
            {data.pricing.basis !== 'free' ? (
              <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
                {t('res.facility.cancellation', { hours: data.policy.cancellation.freeHours })}
              </Text>
            ) : null}
            {data.rules ? (
              <View style={{ gap: 4, marginTop: 4 }}>
                <Text style={{ fontWeight: '600', color: colors.semantic.text }}>
                  {t('res.facility.rules')}
                </Text>
                <Text style={{ color: colors.semantic.text, fontSize: typography.size.sm }}>
                  {data.rules}
                </Text>
              </View>
            ) : null}
          </Card>
          {canBook ? (
            <Card>
              <ChipGroup<string>
                label={t('res.newPass.day')}
                value={chosenDate}
                onChange={(value) => {
                  setDate(value);
                  setStart(null);
                }}
                options={dates.map((value, index) => ({
                  key: value,
                  label: dateLabel(value, index),
                }))}
              />
              <ChipGroup<string>
                label={t('res.facility.length')}
                value={chosenMinutes ? String(chosenMinutes) : null}
                onChange={(value) => {
                  setMinutes(Number(value));
                  setStart(null);
                }}
                options={durations.map((value) => ({
                  key: String(value),
                  label: durationLabel(value),
                }))}
              />
              {availability.isPending ? <Skeleton height={48} /> : null}
              {availability.isError ? (
                <Text style={{ color: colors.status.danger }}>{errorText(availability.error)}</Text>
              ) : null}
              {availability.data && starts.length === 0 ? (
                <Text style={{ color: colors.semantic.textMuted }}>
                  {t('res.facility.noTimes')}
                </Text>
              ) : null}
              {starts.length > 0 ? (
                <ChipGroup<string>
                  label={t('res.facility.startTime')}
                  value={chosenStart}
                  onChange={(value) => {
                    setStart(value);
                    if (errors.start) setErrors((current) => ({ ...current, start: undefined }));
                  }}
                  options={starts.map((value) => ({
                    key: value,
                    label: formatTime(value).slice(0, 5),
                  }))}
                  error={errors.start}
                />
              ) : errors.start ? (
                <Text style={{ color: colors.status.danger }}>{errors.start}</Text>
              ) : null}
              {data.policy.maxGuests > 0 ? (
                <TextField
                  label={t('res.facility.guests', { count: data.policy.maxGuests })}
                  value={guests}
                  onChangeText={(value) => {
                    setGuests(value.replace(/\D/g, ''));
                    if (errors.guests) setErrors((current) => ({ ...current, guests: undefined }));
                  }}
                  keyboardType="number-pad"
                  error={errors.guests}
                  maxLength={4}
                />
              ) : null}
              <TextField
                label={t('res.facility.purpose')}
                placeholder={t('res.facility.purposePlaceholder')}
                value={purpose}
                onChangeText={setPurpose}
                error={errors.purpose}
                maxLength={200}
              />
            </Card>
          ) : (
            <Banner tone="info">{t('res.facility.cannotBook')}</Banner>
          )}
          {book.isError && Object.values(errors).every((value) => !value) ? (
            <Banner tone="danger">{errorText(book.error)}</Banner>
          ) : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
