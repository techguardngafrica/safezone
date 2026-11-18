import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { FACILITY_ICON } from '../../src/features/facility-icon';
import { priceLabel } from '../../src/features/facilities';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Estate facilities residents can book (UI_GUIDELINES §8.1 More: facilities). */
export default function FacilitiesScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const facilities = useQuery({
    queryKey: ['estate', estateId, 'facilities'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/facilities', { params: { path: { estateId } } })),
  });
  const pull = usePullRefresh(facilities.refetch);
  const open = (facilities.data ?? []).filter((facility) => facility.status === 'active');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.facility.title')}
        subtitle={t('res.facility.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <ActionButton
        label={t('res.booking.mine')}
        variant="outline"
        icon={<Icon name="calendar-outline" color={colors.brand.primary} size={20} />}
        onPress={() => router.push('/bookings')}
      />
      {facilities.isPending ? <Skeleton height={96} /> : null}
      {facilities.isError ? (
        <ErrorState
          message={errorText(facilities.error)}
          onRetry={() => void facilities.refetch()}
        />
      ) : null}
      {facilities.data && open.length === 0 ? (
        <EmptyState
          icon={<Icon name="calendar-outline" size={28} color={colors.brand.primary} />}
          title={t('res.facility.empty')}
          body={t('res.facility.emptyBody')}
        />
      ) : null}
      {open.map((facility) => (
        <Card
          key={facility.id}
          onPress={() => router.push(`/facilities/${facility.id}`)}
          accessibilityLabel={`${facility.name}, ${priceLabel(facility.pricing)}`}
        >
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.brand.primarySubtle,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={FACILITY_ICON[facility.type]} color={colors.brand.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: typography.size.md,
                  fontWeight: '600',
                  color: colors.semantic.text,
                }}
              >
                {facility.name}
              </Text>
              <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                {t(`res.facility.type.${facility.type}` as MessageKey)}
                {facility.capacity
                  ? ` · ${t('res.facility.capacity', { count: facility.capacity })}`
                  : ''}
              </Text>
            </View>
            <Text
              style={{
                fontSize: typography.size.sm,
                fontWeight: '600',
                color: colors.semantic.text,
              }}
            >
              {priceLabel(facility.pricing)}
            </Text>
          </View>
        </Card>
      ))}
    </ScrollScreen>
  );
}
