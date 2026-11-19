import { unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  type Tone,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Icon } from '../src/components/icon';
import { errorText } from '../src/lib/errors';
import { useResident } from '../src/lib/resident';
import { api } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

const TONE: Record<'at_gate' | 'collected' | 'returned', Tone> = {
  at_gate: 'warning',
  collected: 'success',
  returned: 'neutral',
};

/** Parcels couriers left with estate security for the resident's household. No ads. */
export default function ParcelsScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const parcels = useQuery({
    queryKey: ['estate', estateId, 'deliveries', 'mine'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/deliveries', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
  });
  const pull = usePullRefresh(parcels.refetch);
  const items = parcels.data?.items ?? [];

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.parcels.title')}
        subtitle={t('res.parcels.hint')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {parcels.isPending ? <Skeleton height={120} /> : null}
      {parcels.isError ? (
        <ErrorState message={errorText(parcels.error)} onRetry={() => void parcels.refetch()} />
      ) : null}
      {parcels.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="cube-outline" size={28} color={colors.brand.primary} />}
          title={t('res.parcels.empty')}
          body={t('res.parcels.emptyBody')}
        />
      ) : null}
      {items.length > 0 ? (
        <Card>
          {items.map((item) => (
            <ListRow
              key={item.id}
              title={item.company}
              subtitle={t('res.parcels.at', {
                gate: item.gateName ?? '',
                time: formatDateTime(item.createdAt),
              })}
              leading={<Icon name="cube-outline" color={colors.brand.primary} size={20} />}
              trailing={
                <StatusPill
                  tone={TONE[item.status]}
                  label={t(`res.parcels.status.${item.status}` as MessageKey)}
                />
              }
            />
          ))}
        </Card>
      ) : null}
    </ScrollScreen>
  );
}
