import { unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Icon } from '../../../src/components/icon';
import { marketStyles, Muted, Row } from '../../../src/features/market-text';
import {
  naira,
  NETWORK_LABELS,
  type Network,
  statusLabel,
  statusTone,
} from '../../../src/features/wallet';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';

const MOVING = new Set(['created', 'paid', 'delivering', 'refund_pending']);

/** One airtime or data purchase: paid only after verification; delivered, or refunded in full. */
export default function TopupScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const { id } = useLocalSearchParams<{ id: string }>();
  const purchase = useQuery({
    queryKey: ['estate', estateId, 'topup', id],
    queryFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/topups/{id}/verify', {
          params: { path: { estateId, id } },
        }),
      ),
    refetchInterval: (query) => (MOVING.has(query.state.data?.status ?? '') ? 5_000 : false),
  });
  const data = purchase.data;
  const phone = data?.phone.replace('+234', '0') ?? '';
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={data?.kind === 'data' ? t('res.topup.dataTitle') : t('res.topup.airtimeTitle')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/wallet'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {purchase.isPending ? <Skeleton height={120} /> : null}
      {purchase.isError ? (
        <ErrorState message={errorText(purchase.error)} onRetry={() => void purchase.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            <Row>
              <Text style={marketStyles.big}>{naira(data.totalKobo)}</Text>
              <StatusPill tone={statusTone(data.status)} label={statusLabel(data.status)} />
            </Row>
            <Muted>
              {NETWORK_LABELS[data.network as Network]} · {phone}
              {data.planName ? ` · ${data.planName}` : ''}
            </Muted>
            <Muted>{formatDateTime(data.createdAt)}</Muted>
          </Card>
          {data.status === 'created' ? (
            <Banner tone="info">{t('res.wallet.checking')}</Banner>
          ) : null}
          {data.status === 'paid' || data.status === 'delivering' ? (
            <Banner tone="info">{t('res.topup.delivering', { phone })}</Banner>
          ) : null}
          {data.status === 'delivered' ? (
            <Banner tone="success">{t('res.topup.delivered', { phone })}</Banner>
          ) : null}
          {data.status === 'refund_pending' ? (
            <Banner tone="warning">{t('res.topup.refundPending')}</Banner>
          ) : null}
          {data.status === 'refunded' ? (
            <Banner tone="neutral">{t('res.topup.refunded')}</Banner>
          ) : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
