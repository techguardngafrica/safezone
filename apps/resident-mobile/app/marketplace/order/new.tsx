import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../../src/components/icon';
import { priceText } from '../../../src/features/marketplace';
import { marketStyles, Muted, Row } from '../../../src/features/market-text';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';

/** Place an order or ask for a quote. Nothing is charged here: payment comes after the vendor accepts. */
export default function NewOrderScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const { vendorId, listingId } = useLocalSearchParams<{ vendorId: string; listingId: string }>();
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ['estate', estateId, 'marketplace', 'vendor', vendorId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/marketplace/vendors/{vendorId}', {
          params: { path: { estateId, vendorId } },
        }),
      ),
  });
  const listing = profile.data?.listings.find((l) => l.id === listingId);
  const place = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders', {
          params: { path: { estateId } },
          body: {
            listingId,
            details: details.trim(),
            ...(household ? { spaceId: household.unit.id } : {}),
          },
        }),
      ),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'marketplace', 'orders'],
      });
      router.replace(`/marketplace/orders/${order.id}`);
    },
  });
  const submit = () => {
    if (details.trim().length < 3) return setError(t('res.market.newOrder.detailsRequired'));
    setError(null);
    place.mutate();
  };
  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        listing ? (
          <ActionButton
            label={t('res.market.newOrder.submit')}
            busy={place.isPending}
            onPress={submit}
          />
        ) : undefined
      }
    >
      <ScreenHeader
        title={t('res.market.newOrder.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {profile.isPending ? <Skeleton height={120} /> : null}
      {profile.isError ? (
        <ErrorState message={errorText(profile.error)} onRetry={() => void profile.refetch()} />
      ) : null}
      {profile.data && !listing ? <ErrorState message={t('api.error.LISTING_NOT_FOUND')} /> : null}
      {listing && profile.data ? (
        <>
          <Card>
            <Row>
              <Text style={marketStyles.title}>{listing.title}</Text>
              <Text style={marketStyles.price}>{priceText(listing)}</Text>
            </Row>
            <Muted>{profile.data.vendor.name}</Muted>
            {household ? (
              <Muted>{t('res.market.newOrder.unit', { unit: household.unit.code })}</Muted>
            ) : null}
          </Card>
          <Banner tone="info">
            {listing.priceType === 'fixed'
              ? t('res.market.newOrder.fixedNote')
              : t('res.market.newOrder.quoteNote')}
          </Banner>
          <TextField
            label={t('res.market.newOrder.details')}
            helper={t('res.market.newOrder.detailsHelper')}
            value={details}
            onChangeText={setDetails}
            error={error}
            multiline
            maxLength={2000}
          />
          {place.isError ? <Banner tone="danger">{errorText(place.error)}</Banner> : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
