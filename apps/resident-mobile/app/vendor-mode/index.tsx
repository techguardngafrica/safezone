import { unwrap, unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
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
import { Linking, Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  chooseVendor,
  chosenVendor,
  isOpenOrder,
  nairaText,
  ORDER_TONE,
} from '../../src/features/marketplace';
import { marketStyles, Muted, Row } from '../../src/features/market-text';
import { config } from '../../src/lib/config';
import { errorText } from '../../src/lib/errors';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/**
 * Vendor mode (marketplace.md §1): a vendor's orders inside the Resident App. Listings, payout and team are
 * managed in the Vendor Portal on the web. The API checks the vendor role on every call.
 */
export default function VendorModeScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(chosenVendor());
  const [view, setView] = useState<'open' | 'done'>('open');
  const mine = useQuery({
    queryKey: ['me', 'vendors'],
    queryFn: () => unwrap(api.GET('/v1/me/vendors')),
  });
  const vendor = mine.data?.find((v) => v.id === selected) ?? mine.data?.[0];
  const orders = useQuery({
    queryKey: ['vendor', vendor?.id, 'orders'],
    enabled: Boolean(vendor),
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/vendors/{vendorId}/orders', {
          params: { path: { vendorId: vendor?.id ?? '' }, query: { limit: 100 } },
        }),
      ),
  });
  const pull = usePullRefresh(orders.refetch);
  const shown = (orders.data?.items ?? []).filter((o) =>
    view === 'open' ? isOpenOrder(o.status) : !isOpenOrder(o.status),
  );
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.vendorMode.title')}
        subtitle={vendor ? t('res.vendorMode.subtitle', { vendor: vendor.name }) : undefined}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {mine.isPending ? <Skeleton height={80} /> : null}
      {mine.isError ? (
        <ErrorState message={errorText(mine.error)} onRetry={() => void mine.refetch()} />
      ) : null}
      {mine.data && mine.data.length > 1 && vendor ? (
        <ChipGroup
          label={t('res.vendorMode.switch')}
          value={vendor.id}
          onChange={(id) => {
            chooseVendor(id);
            setSelected(id);
          }}
          options={mine.data.map((v) => ({ key: v.id, label: v.name }))}
        />
      ) : null}
      {vendor && vendor.status !== 'approved' ? (
        <Banner tone="warning">
          {t('res.vendorMode.notApproved', {
            status: t(`vendor.status.${vendor.status}` as MessageKey).toLowerCase(),
          })}
        </Banner>
      ) : null}
      <Banner tone="info">{t('res.vendorMode.portalNote')}</Banner>
      <ActionButton
        label={t('res.vendorMode.openPortal')}
        variant="outline"
        onPress={() => void Linking.openURL(`${config.publicWebUrl.replace(/\/$/, '')}/vendor`)}
      />
      {vendor ? (
        <Segmented
          label={t('res.vendorMode.title')}
          value={view}
          onChange={setView}
          options={[
            { key: 'open', label: t('res.vendorMode.filter.open') },
            { key: 'done', label: t('res.vendorMode.filter.done') },
          ]}
        />
      ) : null}
      {orders.isPending && vendor ? <Skeleton height={88} /> : null}
      {orders.isError ? (
        <ErrorState message={errorText(orders.error)} onRetry={() => void orders.refetch()} />
      ) : null}
      {orders.data && shown.length === 0 ? (
        <EmptyState
          icon={<Icon name="clipboard-outline" size={28} color={colors.brand.primary} />}
          title={t('res.vendorMode.empty')}
        />
      ) : null}
      {vendor
        ? shown.map((order) => (
            <Card
              key={order.id}
              onPress={() =>
                router.push({
                  pathname: '/vendor-mode/[id]',
                  params: { id: order.id, vendorId: vendor.id },
                })
              }
              accessibilityLabel={`${order.listingTitle}, ${t(`vendor.orderStatus.${order.status}` as MessageKey)}`}
            >
              <Row>
                <Text style={marketStyles.title}>{order.listingTitle}</Text>
                <StatusPill
                  tone={ORDER_TONE[order.status]}
                  label={t(`vendor.orderStatus.${order.status}` as MessageKey)}
                />
              </Row>
              <Muted numberOfLines={2}>{order.details}</Muted>
              <Muted>
                {formatDate(order.createdAt)}
                {order.amountKobo !== null ? ` · ${nairaText(order.amountKobo)}` : ''}
              </Muted>
            </Card>
          ))
        : null}
    </ScrollScreen>
  );
}
