import { unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDate, t } from '@safezone/i18n';
import {
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Icon } from '../../../src/components/icon';
import { nairaText, ORDER_TONE, orderStatusLabel } from '../../../src/features/marketplace';
import { marketStyles, Muted, Row } from '../../../src/features/market-text';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';
import { usePullRefresh } from '../../../src/lib/use-pull-refresh';

export default function MyOrdersScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const orders = useQuery({
    queryKey: ['estate', estateId, 'marketplace', 'orders'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/marketplace/orders', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
  });
  const pull = usePullRefresh(orders.refetch);
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.market.orders.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {orders.isPending ? <Skeleton height={88} /> : null}
      {orders.isError ? (
        <ErrorState message={errorText(orders.error)} onRetry={() => void orders.refetch()} />
      ) : null}
      {orders.data && orders.data.items.length === 0 ? (
        <EmptyState
          icon={<Icon name="bag-handle-outline" size={28} color={colors.brand.primary} />}
          title={t('res.market.orders.empty')}
        />
      ) : null}
      {orders.data?.items.map((order) => (
        <Card
          key={order.id}
          onPress={() => router.push(`/marketplace/orders/${order.id}`)}
          accessibilityLabel={`${order.listingTitle}, ${orderStatusLabel(order.status)}`}
        >
          <Row>
            <Text style={marketStyles.title}>{order.listingTitle}</Text>
            <StatusPill tone={ORDER_TONE[order.status]} label={orderStatusLabel(order.status)} />
          </Row>
          <Muted>
            {order.vendorName} · {formatDate(order.createdAt)}
            {order.amountKobo !== null ? ` · ${nairaText(order.amountKobo)}` : ''}
          </Muted>
        </Card>
      ))}
    </ScrollScreen>
  );
}
