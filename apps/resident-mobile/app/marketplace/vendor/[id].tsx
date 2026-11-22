import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDate, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Icon } from '../../../src/components/icon';
import { priceText } from '../../../src/features/marketplace';
import { Body, marketStyles, Muted, Row } from '../../../src/features/market-text';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';

/** A vendor's page for residents: profile, live listings and this estate's reviews. */
export default function VendorPage() {
  const router = useRouter();
  const { estateId } = useResident();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useQuery({
    queryKey: ['estate', estateId, 'marketplace', 'vendor', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/marketplace/vendors/{vendorId}', {
          params: { path: { estateId, vendorId: id } },
        }),
      ),
  });
  const data = profile.data;
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={data?.vendor.name ?? t('res.market.title')}
        subtitle={data?.vendor.verified ? t('res.market.verified') : undefined}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {profile.isPending ? <Skeleton height={160} /> : null}
      {profile.isError ? (
        <ErrorState message={errorText(profile.error)} onRetry={() => void profile.refetch()} />
      ) : null}
      {data ? (
        <>
          <Card>
            <Body>{data.vendor.description}</Body>
            <Muted>
              {data.vendor.ratingAvg === null
                ? t('res.market.noReviews')
                : t('res.market.rating', {
                    rating: data.vendor.ratingAvg.toFixed(1),
                    count: data.vendor.ratingCount,
                  })}
            </Muted>
          </Card>
          <SectionHeader title={t('res.market.vendor.listings')} />
          {data.listings.map((listing) => (
            <Card key={listing.id}>
              <Row>
                <Text style={marketStyles.title}>{listing.title}</Text>
                <Text style={marketStyles.price}>{priceText(listing)}</Text>
              </Row>
              <Body>{listing.description}</Body>
              <ActionButton
                label={
                  listing.priceType === 'fixed'
                    ? t('res.market.order')
                    : t('res.market.requestQuote')
                }
                variant="outline"
                onPress={() =>
                  router.push({
                    pathname: '/marketplace/order/new',
                    params: { vendorId: data.vendor.id, listingId: listing.id },
                  })
                }
              />
            </Card>
          ))}
          <SectionHeader title={t('res.market.vendor.reviews')} />
          {data.reviews.length === 0 ? <Muted>{t('res.market.vendor.noReviews')}</Muted> : null}
          {data.reviews.map((review) => (
            <Card key={review.id}>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                <Icon name="star" size={16} color={colors.brand.primary} />
                <Text style={marketStyles.label}>
                  {t('res.market.orders.stars', { rating: review.rating })}
                </Text>
                <Muted> · {formatDate(review.createdAt)}</Muted>
              </View>
              {review.comment ? <Body>{review.comment}</Body> : null}
              {review.vendorResponse ? <Muted>{review.vendorResponse}</Muted> : null}
            </Card>
          ))}
        </>
      ) : null}
    </ScrollScreen>
  );
}
