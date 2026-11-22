import { unwrap } from '@safezone/api-client';
import { formatDate, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Linking, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { marketStyles, Muted, Row } from '../../src/features/market-text';
import { campaignTone, rememberCampaign } from '../../src/features/marketplace';
import { errorText } from '../../src/lib/errors';
import { api } from '../../src/lib/session';

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** One campaign in Advertiser mode: status, results, creatives' review and invoices (paid to Safezone). */
export default function AdvertiserCampaignScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id, advertiserId } = useLocalSearchParams<{ id: string; advertiserId: string }>();
  const path = { advertiserId, id };
  const campaign = useQuery({
    queryKey: ['advertiser', advertiserId, 'campaign', id],
    queryFn: () =>
      unwrap(api.GET('/v1/advertisers/{advertiserId}/campaigns/{id}', { params: { path } })),
  });
  const report = useQuery({
    queryKey: ['advertiser', advertiserId, 'campaign', id, 'report'],
    queryFn: () =>
      unwrap(api.GET('/v1/advertisers/{advertiserId}/campaigns/{id}/report', { params: { path } })),
  });
  const invoicesKey = ['advertiser', advertiserId, 'campaign', id, 'invoices'];
  const invoices = useQuery({
    queryKey: invoicesKey,
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/campaigns/{id}/invoices', { params: { path } }),
      ),
  });
  const verify = useMutation({
    mutationFn: (invoiceId: string) =>
      unwrap(
        api.POST('/v1/advertisers/{advertiserId}/invoices/{id}/verify', {
          params: { path: { advertiserId, id: invoiceId } },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoicesKey });
      void campaign.refetch();
    },
  });
  // Back from checkout: verify open invoices with the provider through the API.
  useFocusEffect(
    useCallback(() => {
      for (const invoice of invoices.data ?? [])
        if (invoice.status === 'issued') verify.mutate(invoice.id);
    }, [invoices.data]),
  );
  const pay = useMutation({
    mutationFn: (invoiceId: string) =>
      unwrap(
        api.POST('/v1/advertisers/{advertiserId}/invoices/{id}/pay', {
          params: { path: { advertiserId, id: invoiceId } },
          body: inExpoGo ? {} : { callbackUrl: 'safezone://advertiser-mode/return' },
        }),
      ),
    onSuccess: (checkout) => {
      rememberCampaign({ advertiserId, campaignId: id });
      void Linking.openURL(checkout.authorizationUrl);
    },
  });

  const c = campaign.data;
  const r = report.data;
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={c?.title ?? t('res.advertiserMode.title')}
        subtitle={c?.objective}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/advertiser-mode'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {campaign.isPending ? <Skeleton height={140} /> : null}
      {campaign.isError ? (
        <ErrorState message={errorText(campaign.error)} onRetry={() => void campaign.refetch()} />
      ) : null}
      {c ? (
        <>
          <Card>
            <Row>
              <Text style={marketStyles.big}>{formatKobo(c.budgetKobo)}</Text>
              <StatusPill
                tone={campaignTone(c.status)}
                label={t(`advertiser.status.${c.status}` as MessageKey)}
              />
            </Row>
            <Muted>
              {t('advertiser.campaigns.runs', {
                from: formatDate(c.startsAt),
                to: formatDate(c.endsAt),
              })}
            </Muted>
          </Card>
          {c.status === 'rejected' && c.rejectionReason ? (
            <Banner tone="warning">
              {t('advertiser.detail.rejected', { reason: c.rejectionReason })}
            </Banner>
          ) : null}

          <SectionHeader title={t('res.advertiserMode.results')} />
          {r ? (
            <Card>
              <Row>
                <Text style={marketStyles.label}>{t('advertiser.report.impressions')}</Text>
                <Text style={marketStyles.label}>{r.impressions}</Text>
              </Row>
              <Row>
                <Text style={marketStyles.label}>{t('advertiser.report.clicks')}</Text>
                <Text style={marketStyles.label}>{r.clicks}</Text>
              </Row>
              <Row>
                <Text style={marketStyles.label}>{t('advertiser.report.ctr')}</Text>
                <Text style={marketStyles.label}>{`${r.ctr}%`}</Text>
              </Row>
              <Row>
                <Text style={marketStyles.label}>{t('advertiser.report.reach')}</Text>
                <Text style={marketStyles.label}>{r.uniqueReachEstimate}</Text>
              </Row>
              {r.impressions === 0 ? <Muted>{t('advertiser.report.empty')}</Muted> : null}
            </Card>
          ) : (
            <Skeleton height={100} />
          )}

          <SectionHeader title={t('res.advertiserMode.creatives')} />
          {c.creatives.length === 0 ? <Muted>{t('advertiser.creatives.empty')}</Muted> : null}
          {c.creatives.map((creative) => (
            <Card key={creative.id}>
              <Row>
                <Text style={marketStyles.title}>{creative.headline}</Text>
                <StatusPill
                  tone={
                    creative.reviewStatus === 'approved'
                      ? 'success'
                      : creative.reviewStatus === 'pending'
                        ? 'info'
                        : 'warning'
                  }
                  label={t(`advertiser.review.${creative.reviewStatus}` as MessageKey)}
                />
              </Row>
              {creative.reviewNotes ? (
                <Muted>{t('advertiser.creatives.notes', { notes: creative.reviewNotes })}</Muted>
              ) : null}
            </Card>
          ))}

          <SectionHeader title={t('res.advertiserMode.invoices')} />
          {verify.isPending ? <Banner tone="info">{t('res.advertiserMode.paying')}</Banner> : null}
          {invoices.data?.length === 0 ? <Muted>{t('advertiser.invoices.empty')}</Muted> : null}
          {invoices.data?.map((invoice) => (
            <Card key={invoice.id}>
              <Text style={marketStyles.label}>{invoice.number}</Text>
              <Muted>
                {t('advertiser.invoices.amount', {
                  amount: formatKobo(invoice.amountKobo),
                  vat: formatKobo(invoice.vatKobo),
                  total: formatKobo(invoice.totalKobo),
                })}
              </Muted>
              <View>
                {invoice.status === 'paid' ? (
                  <StatusPill
                    tone="success"
                    label={t('advertiser.invoices.paid', { date: formatDate(invoice.paidAt) })}
                  />
                ) : invoice.status === 'issued' ? (
                  <ActionButton
                    label={t('advertiser.invoices.pay', { amount: formatKobo(invoice.totalKobo) })}
                    busy={pay.isPending}
                    onPress={() => pay.mutate(invoice.id)}
                  />
                ) : null}
              </View>
            </Card>
          ))}
          {pay.isError ? <Banner tone="danger">{errorText(pay.error)}</Banner> : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}
