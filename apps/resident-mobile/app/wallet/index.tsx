import { unwrap, unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDate, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon, type IconName } from '../../src/components/icon';
import { marketStyles, Muted, Row } from '../../src/features/market-text';
import {
  naira,
  NETWORK_LABELS,
  type Network,
  statusLabel,
  statusTone,
} from '../../src/features/wallet';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <ListRow
      title={label}
      leading={<Icon name={icon} color={colors.brand.primary} size={20} />}
      trailing={<Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />}
      onPress={onPress}
    />
  );
}

/** Safezone Pay (ADR-0025): no balance; saved cards, send money, airtime, data and recent activity. */
export default function WalletScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { estateId } = useResident();
  const [removing, setRemoving] = useState<string | null>(null);
  const cards = useQuery({
    queryKey: ['me', 'payment-methods'],
    queryFn: () => unwrap(api.GET('/v1/me/payment-methods')),
  });
  const transfers = useQuery({
    queryKey: ['estate', estateId, 'transfers'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/transfers', {
          params: { path: { estateId }, query: { limit: 10 } },
        }),
      ),
  });
  const topups = useQuery({
    queryKey: ['estate', estateId, 'topups'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/topups', {
          params: { path: { estateId }, query: { limit: 10 } },
        }),
      ),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/v1/me/payment-methods/{id}', { params: { path: { id } } })),
    onSuccess: (data) => {
      qc.setQueryData(['me', 'payment-methods'], data);
      setRemoving(null);
    },
  });
  const pull = usePullRefresh(async () => {
    await Promise.all([cards.refetch(), transfers.refetch(), topups.refetch()]);
  });
  const activity = [
    ...(transfers.data?.items ?? []).map((tr) => ({
      key: `t-${tr.id}`,
      at: tr.createdAt,
      title:
        tr.direction === 'sent'
          ? t('res.wallet.sentTo', { name: tr.counterpartyFirstName })
          : t('res.wallet.receivedFrom', { name: tr.counterpartyFirstName }),
      amount: tr.amountKobo,
      status: tr.status,
      onPress: () => router.push(`/wallet/transfer/${tr.id}`),
    })),
    ...(topups.data?.items ?? []).map((tp) => ({
      key: `p-${tp.id}`,
      at: tp.createdAt,
      title: t('res.wallet.topupLine', {
        product:
          tp.kind === 'airtime'
            ? `${NETWORK_LABELS[tp.network as Network]} airtime`
            : (tp.planName ?? 'Data'),
        phone: tp.phone.replace('+234', '0'),
      }),
      amount: tp.totalKobo,
      status: tp.status,
      onPress: () => router.push(`/wallet/topup/${tp.id}`),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.wallet.title')}
        subtitle={t('res.wallet.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Banner tone="info">{t('res.wallet.noBalance')}</Banner>
      <Card>
        <Action
          icon="paper-plane-outline"
          label={t('res.wallet.send')}
          onPress={() => router.push('/wallet/send')}
        />
        <Action
          icon="phone-portrait-outline"
          label={t('res.wallet.airtime')}
          onPress={() => router.push({ pathname: '/wallet/buy', params: { kind: 'airtime' } })}
        />
        <Action
          icon="wifi-outline"
          label={t('res.wallet.data')}
          onPress={() => router.push({ pathname: '/wallet/buy', params: { kind: 'data' } })}
        />
        <Action
          icon="download-outline"
          label={t('res.wallet.receive')}
          onPress={() => router.push('/wallet/receive')}
        />
      </Card>

      <SectionHeader title={t('res.wallet.cards')} />
      {cards.data?.length === 0 ? <Muted>{t('res.wallet.noCards')}</Muted> : null}
      {cards.data?.map((card) => (
        <Card key={card.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={marketStyles.title}>
                {t('res.wallet.cardLabel', { brand: card.brand.toUpperCase(), last4: card.last4 })}
              </Text>
              <Muted>
                {t('res.wallet.cardExpiry', { month: card.expMonth, year: card.expYear })}
                {card.bank ? ` · ${card.bank}` : ''}
              </Muted>
            </View>
            <ActionButton
              label={t('res.wallet.removeCard')}
              variant="text"
              onPress={() => setRemoving(card.id)}
            />
          </Row>
        </Card>
      ))}

      <SectionHeader title={t('res.wallet.history')} />
      {transfers.isError ? <Banner tone="danger">{errorText(transfers.error)}</Banner> : null}
      {activity.length === 0 && transfers.data && topups.data ? (
        <Muted>{t('res.wallet.noHistory')}</Muted>
      ) : null}
      {activity.map((item) => (
        <Card
          key={item.key}
          onPress={item.onPress}
          accessibilityLabel={`${item.title}, ${naira(item.amount)}, ${statusLabel(item.status)}`}
        >
          <Row>
            <Text style={marketStyles.title}>{item.title}</Text>
            <Text style={marketStyles.price}>{naira(item.amount)}</Text>
          </Row>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <StatusPill tone={statusTone(item.status)} label={statusLabel(item.status)} />
            <Muted>{formatDate(item.at)}</Muted>
          </View>
        </Card>
      ))}

      <ConfirmModal
        visible={removing !== null}
        title={t('res.wallet.removeCardTitle')}
        body={t('res.wallet.removeCardBody')}
        confirmLabel={t('res.wallet.removeCard')}
        destructive
        busy={remove.isPending}
        error={remove.isError ? errorText(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </ScrollScreen>
  );
}
