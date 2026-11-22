import { unwrap, unwrapPage } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { classifiedPriceText, priceText } from '../../src/features/marketplace';
import { marketStyles, Muted, Row } from '../../src/features/market-text';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type Tab = 'vendors' | 'neighbours';

function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Services() {
  const router = useRouter();
  const { estateId } = useResident();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const search = useDebounced(q.trim());
  const categories = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => unwrap(api.GET('/v1/marketplace/categories')),
  });
  const listings = useQuery({
    queryKey: ['estate', estateId, 'marketplace', 'listings', search, category],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/marketplace/listings', {
          params: {
            path: { estateId },
            query: {
              limit: 50,
              ...(search.length >= 2 ? { q: search } : {}),
              ...(category !== 'all' ? { category } : {}),
            },
          },
        }),
      ),
  });
  return (
    <>
      <TextField
        label={t('res.market.search')}
        value={q}
        onChangeText={setQ}
        placeholder={t('res.market.searchPlaceholder')}
        maxLength={80}
      />
      {categories.data ? (
        <ChipGroup
          label={t('vendor.listings.form.category')}
          value={category}
          onChange={setCategory}
          options={[
            { key: 'all', label: t('res.market.allCategories') },
            ...categories.data.map((c) => ({ key: c.id, label: c.name })),
          ]}
        />
      ) : null}
      {listings.isPending ? <Skeleton height={96} /> : null}
      {listings.isError ? (
        <ErrorState message={errorText(listings.error)} onRetry={() => void listings.refetch()} />
      ) : null}
      {listings.data && listings.data.items.length === 0 ? (
        <EmptyState
          icon={<Icon name="storefront-outline" size={28} color={colors.brand.primary} />}
          title={t('res.market.empty.title')}
          body={t('res.market.empty.body')}
        />
      ) : null}
      {listings.data?.items.map((listing) => (
        <Card
          key={listing.id}
          onPress={() => router.push(`/marketplace/vendor/${listing.vendor.id}`)}
          accessibilityLabel={`${listing.title}, ${listing.vendor.name}, ${priceText(listing)}`}
        >
          <Row>
            <Text style={marketStyles.title}>{listing.title}</Text>
            <Text style={marketStyles.price}>{priceText(listing)}</Text>
          </Row>
          <Muted>
            {listing.vendor.name} ·{' '}
            {listing.vendor.ratingAvg === null
              ? t('res.market.noReviews')
              : t('res.market.rating', {
                  rating: listing.vendor.ratingAvg.toFixed(1),
                  count: listing.vendor.ratingCount,
                })}
          </Muted>
        </Card>
      ))}
    </>
  );
}

function Neighbours() {
  const router = useRouter();
  const { estateId, can } = useResident();
  const [mine, setMine] = useState(false);
  const items = useQuery({
    queryKey: ['estate', estateId, 'classifieds', mine],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/classifieds', {
          params: { path: { estateId }, query: { limit: 50, ...(mine ? { mine: true } : {}) } },
        }),
      ),
  });
  return (
    <>
      {can('marketplace.sell') ? (
        <ActionButton
          label={t('res.classifieds.post')}
          icon={<Icon name="add" color="#FFFFFF" size={20} />}
          onPress={() => router.push('/classifieds/new')}
        />
      ) : null}
      <Segmented
        label={t('res.market.tab.neighbours')}
        value={mine ? 'mine' : 'all'}
        onChange={(key) => setMine(key === 'mine')}
        options={[
          { key: 'all', label: t('res.market.allCategories') },
          { key: 'mine', label: t('res.classifieds.mine') },
        ]}
      />
      {items.isPending ? <Skeleton height={96} /> : null}
      {items.isError ? (
        <ErrorState message={errorText(items.error)} onRetry={() => void items.refetch()} />
      ) : null}
      {items.data && items.data.items.length === 0 ? (
        <EmptyState
          icon={<Icon name="pricetags-outline" size={28} color={colors.brand.primary} />}
          title={t('res.classifieds.empty.title')}
          body={t('res.classifieds.empty.body')}
        />
      ) : null}
      {items.data?.items.map((item) => (
        <Card
          key={item.id}
          onPress={() => router.push(`/classifieds/${item.id}`)}
          accessibilityLabel={`${item.title}, ${classifiedPriceText(item)}`}
        >
          <Row>
            <Text style={marketStyles.title}>{item.title}</Text>
            <Text style={marketStyles.price}>{classifiedPriceText(item)}</Text>
          </Row>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Muted>{t(`res.classifieds.kind.${item.kind}` as MessageKey)}</Muted>
            {item.status !== 'active' ? (
              <StatusPill
                tone="neutral"
                label={t(`res.classifieds.status.${item.status}` as MessageKey)}
              />
            ) : null}
          </View>
        </Card>
      ))}
    </>
  );
}

/** Marketplace hub (marketplace.md §2): vendors the estate allows, and neighbours' classifieds. No ads here yet. */
export default function MarketplaceScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('vendors');
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.market.title')}
        subtitle={t('res.market.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
        trailing={
          <ActionButton
            label={t('res.market.myOrders')}
            variant="text"
            onPress={() => router.push('/marketplace/orders')}
          />
        }
      />
      <Segmented
        label={t('res.market.title')}
        value={tab}
        onChange={setTab}
        options={[
          { key: 'vendors', label: t('res.market.tab.vendors') },
          { key: 'neighbours', label: t('res.market.tab.neighbours') },
        ]}
      />
      {tab === 'vendors' ? <Services /> : <Neighbours />}
    </ScrollScreen>
  );
}
