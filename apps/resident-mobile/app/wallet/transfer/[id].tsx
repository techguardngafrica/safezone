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
import { naira, statusLabel, statusTone } from '../../../src/features/wallet';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';

/** One transfer. "Paid" only after the API verified the payment with the provider. */
export default function TransferScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transfer = useQuery({
    queryKey: ['estate', estateId, 'transfer', id],
    queryFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/transfers/{id}/verify', {
          params: { path: { estateId, id } },
        }),
      ),
    refetchInterval: (query) => (query.state.data?.status === 'created' ? 4_000 : false),
  });
  const data = transfer.data;
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.send.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/wallet'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {transfer.isPending ? <Skeleton height={120} /> : null}
      {transfer.isError ? (
        <ErrorState message={errorText(transfer.error)} onRetry={() => void transfer.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            <Row>
              <Text style={marketStyles.big}>{naira(data.amountKobo)}</Text>
              <StatusPill tone={statusTone(data.status)} label={statusLabel(data.status)} />
            </Row>
            <Muted>
              {data.direction === 'sent'
                ? t('res.wallet.sentTo', { name: data.counterpartyFirstName })
                : t('res.wallet.receivedFrom', { name: data.counterpartyFirstName })}
              {' · '}
              {formatDateTime(data.createdAt)}
            </Muted>
            {data.note ? <Muted>{data.note}</Muted> : null}
          </Card>
          {data.status === 'created' ? (
            <Banner tone="info">{t('res.wallet.checking')}</Banner>
          ) : null}
          {data.status === 'paid' && data.direction === 'sent' ? (
            <Banner tone="success">{t('res.send.sent')}</Banner>
          ) : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
