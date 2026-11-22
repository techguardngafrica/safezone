import { unwrap } from '@safezone/api-client';
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
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { campaignTone } from '../../src/features/marketplace';
import { marketStyles, Muted, Row } from '../../src/features/market-text';
import { config } from '../../src/lib/config';
import { errorText } from '../../src/lib/errors';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Advertiser mode (advertising.md §1): an advertiser member's campaigns inside the Resident App. */
export default function AdvertiserModeScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const mine = useQuery({
    queryKey: ['me', 'advertisers'],
    queryFn: () => unwrap(api.GET('/v1/me/advertisers')),
  });
  const advertiser = mine.data?.find((a) => a.id === selected) ?? mine.data?.[0];
  const campaigns = useQuery({
    queryKey: ['advertiser', advertiser?.id, 'campaigns'],
    enabled: Boolean(advertiser),
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/campaigns', {
          params: { path: { advertiserId: advertiser?.id ?? '' } },
        }),
      ),
  });
  const pull = usePullRefresh(campaigns.refetch);
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.advertiserMode.title')}
        subtitle={
          advertiser ? t('res.advertiserMode.subtitle', { name: advertiser.name }) : undefined
        }
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {mine.isPending ? <Skeleton height={80} /> : null}
      {mine.isError ? (
        <ErrorState message={errorText(mine.error)} onRetry={() => void mine.refetch()} />
      ) : null}
      {mine.data && mine.data.length > 1 && advertiser ? (
        <ChipGroup
          label={t('advertiser.switch')}
          value={advertiser.id}
          onChange={setSelected}
          options={mine.data.map((a) => ({ key: a.id, label: a.name }))}
        />
      ) : null}
      {advertiser?.status === 'suspended' ? (
        <Banner tone="danger">{t('advertiser.suspended')}</Banner>
      ) : null}
      <Banner tone="info">{t('res.advertiserMode.webNote')}</Banner>
      <ActionButton
        label={t('res.advertiserMode.openWeb')}
        variant="outline"
        onPress={() => void Linking.openURL(`${config.publicWebUrl.replace(/\/$/, '')}/advertiser`)}
      />
      {campaigns.isPending && advertiser ? <Skeleton height={88} /> : null}
      {campaigns.isError ? (
        <ErrorState message={errorText(campaigns.error)} onRetry={() => void campaigns.refetch()} />
      ) : null}
      {campaigns.data?.length === 0 ? (
        <EmptyState
          icon={<Icon name="megaphone-outline" size={28} color={colors.brand.primary} />}
          title={t('res.advertiserMode.empty')}
        />
      ) : null}
      {advertiser
        ? campaigns.data?.map((campaign) => (
            <Card
              key={campaign.id}
              onPress={() =>
                router.push({
                  pathname: '/advertiser-mode/[id]',
                  params: { id: campaign.id, advertiserId: advertiser.id },
                })
              }
              accessibilityLabel={`${campaign.title}, ${t(`advertiser.status.${campaign.status}` as MessageKey)}`}
            >
              <Row>
                <Text style={marketStyles.title}>{campaign.title}</Text>
                <StatusPill
                  tone={campaignTone(campaign.status)}
                  label={t(`advertiser.status.${campaign.status}` as MessageKey)}
                />
              </Row>
              <Muted>
                {t('advertiser.campaigns.runs', {
                  from: formatDate(campaign.startsAt),
                  to: formatDate(campaign.endsAt),
                })}
              </Muted>
            </Card>
          ))
        : null}
    </ScrollScreen>
  );
}
