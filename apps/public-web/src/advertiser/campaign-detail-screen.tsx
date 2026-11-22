'use client';

import { type ApiData, unwrap } from '@safezone/api-client';
import { formatDate, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  DataTable,
  DetailList,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
  StatCard,
  StatusPill,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useAdvertiser } from './advertiser-shell';
import { campaignStatusLabel, campaignTone } from './campaigns-screen';

type Campaign = ApiData<'/v1/advertisers/{advertiserId}/campaigns/{id}', 'get'>;
type Creative = Campaign['creatives'][number];
type CreativeType = Creative['type'];

function CreativeDialog({
  campaignId,
  revising,
  onClose,
}: {
  campaignId: string;
  revising: Creative | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { advertiserId } = useAdvertiser();
  const [type, setType] = useState<CreativeType>(revising?.type ?? 'image_banner');
  const [imageFileId, setImageFileId] = useState(revising?.imageFileId ?? '');
  const [headline, setHeadline] = useState(revising?.headline ?? '');
  const [body, setBody] = useState(revising?.body ?? '');
  const [cta, setCta] = useState(revising?.cta ?? '');
  const [destinationUrl, setDestinationUrl] = useState(revising?.destinationUrl ?? 'https://');
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        type,
        ...(type !== 'sponsored_text' && imageFileId.trim()
          ? { imageFileId: imageFileId.trim() }
          : {}),
        headline: headline.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        cta: cta.trim(),
        destinationUrl: destinationUrl.trim(),
      };
      return revising
        ? unwrap(
            api.POST(
              '/v1/advertisers/{advertiserId}/campaigns/{id}/creatives/{creativeId}/revise',
              {
                params: { path: { advertiserId, id: campaignId, creativeId: revising.id } },
                body: payload,
              },
            ),
          )
        : unwrap(
            api.POST('/v1/advertisers/{advertiserId}/campaigns/{id}/creatives', {
              params: { path: { advertiserId, id: campaignId } },
              body: payload,
            }),
          );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['advertiser', advertiserId, 'campaign', campaignId] });
      onClose();
    },
  });
  return (
    <Dialog
      title={revising ? t('advertiser.creatives.revise') : t('advertiser.creatives.add')}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      wide
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {revising ? t('advertiser.creatives.revise') : t('advertiser.creatives.add')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        {revising ? <Banner tone="info">{t('advertiser.creatives.reviseNote')}</Banner> : null}
        <Banner tone="info">{t('advertiser.creatives.sponsoredNote')}</Banner>
        <SelectField
          label={t('admin.ads.creatives.type')}
          value={type}
          onChange={setType}
          options={(
            ['image_banner', 'sponsored_text', 'sponsored_post', 'promo_card'] as const
          ).map((value) => ({
            value,
            label: t(`admin.ads.creatives.type.${value}`),
          }))}
        />
        {type !== 'sponsored_text' ? (
          <InputField
            label={t('admin.ads.creatives.image')}
            helper={t('admin.ads.creatives.imageHelper')}
            value={imageFileId}
            onChange={setImageFileId}
            maxLength={36}
          />
        ) : null}
        <InputField
          label={t('admin.ads.creatives.headline')}
          value={headline}
          onChange={setHeadline}
          maxLength={80}
        />
        <TextAreaField
          label={t('admin.ads.creatives.body')}
          value={body}
          onChange={setBody}
          rows={3}
          maxLength={280}
        />
        <InputField
          label={t('admin.ads.creatives.cta')}
          value={cta}
          onChange={setCta}
          maxLength={24}
        />
        <InputField
          label={t('admin.ads.creatives.destination')}
          value={destinationUrl}
          onChange={setDestinationUrl}
          maxLength={500}
        />
        <FormError message={save.isError ? errorText(save.error) : null} />
      </div>
    </Dialog>
  );
}

function Invoices({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const params = useSearchParams();
  const { advertiserId, can } = useAdvertiser();
  const key = ['advertiser', advertiserId, 'campaign', campaignId, 'invoices'];
  const invoices = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/campaigns/{id}/invoices', {
          params: { path: { advertiserId, id: campaignId } },
        }),
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
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['advertiser', advertiserId, 'campaign', campaignId] });
    },
  });
  const pay = useMutation({
    mutationFn: (invoiceId: string) =>
      unwrap(
        api.POST('/v1/advertisers/{advertiserId}/invoices/{id}/pay', {
          params: { path: { advertiserId, id: invoiceId } },
          body: {
            callbackUrl: `${window.location.origin}/advertiser/campaigns/${campaignId}?checkout=1`,
          },
        }),
      ),
    onSuccess: (checkout) => window.location.assign(checkout.authorizationUrl),
  });
  // Back from checkout: ask the provider through the API; "paid" shows only after it is verified.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || params.get('checkout') !== '1' || !invoices.data) return;
    checked.current = true;
    for (const invoice of invoices.data) if (invoice.status === 'issued') verify.mutate(invoice.id);
  }, [invoices.data, params, verify]);

  return (
    <Panel title={t('advertiser.invoices.title')}>
      {invoices.isPending ? <Skeleton height={40} /> : null}
      {invoices.data?.length === 0 ? (
        <p className="sz-muted">{t('advertiser.invoices.empty')}</p>
      ) : null}
      {verify.isPending ? <Banner tone="info">{t('advertiser.invoices.checking')}</Banner> : null}
      {invoices.data?.map((invoice) => (
        <div
          key={invoice.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            padding: '8px 0',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>{invoice.number}</strong>
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {t('advertiser.invoices.amount', {
                amount: formatKobo(invoice.amountKobo),
                vat: formatKobo(invoice.vatKobo),
                total: formatKobo(invoice.totalKobo),
              })}
            </div>
          </div>
          {invoice.status === 'paid' ? (
            <StatusPill
              tone="success"
              label={t('advertiser.invoices.paid', { date: formatDate(invoice.paidAt) })}
            />
          ) : invoice.status === 'issued' && can('advertiser.invoice.pay') ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ActionButton busy={pay.isPending} onClick={() => pay.mutate(invoice.id)}>
                {t('advertiser.invoices.pay', { amount: formatKobo(invoice.totalKobo) })}
              </ActionButton>
              <ActionButton
                variant="text"
                busy={verify.isPending}
                onClick={() => verify.mutate(invoice.id)}
              >
                {t('advertiser.invoices.recheck')}
              </ActionButton>
            </div>
          ) : (
            <StatusPill tone="neutral" label={invoice.status} />
          )}
        </div>
      ))}
      <FormError
        message={
          pay.isError
            ? errorText(pay.error)
            : verify.isError
              ? errorText(verify.error)
              : invoices.isError
                ? errorText(invoices.error)
                : null
        }
      />
    </Panel>
  );
}

function Results({ campaignId }: { campaignId: string }) {
  const { advertiserId } = useAdvertiser();
  const report = useQuery({
    queryKey: ['advertiser', advertiserId, 'campaign', campaignId, 'report'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/campaigns/{id}/report', {
          params: { path: { advertiserId, id: campaignId } },
        }),
      ),
  });
  if (report.isPending) return <Skeleton height={100} />;
  if (report.isError)
    return <ErrorState message={errorText(report.error)} onRetry={() => void report.refetch()} />;
  const r = report.data;
  const estateColumns: Column<(typeof r.byEstate)[number]>[] = [
    { key: 'estate', header: t('advertiser.report.byEstate'), render: (row) => row.estateName },
    {
      key: 'views',
      header: t('advertiser.report.impressions'),
      align: 'right',
      render: (row) => row.impressions,
    },
    {
      key: 'taps',
      header: t('advertiser.report.clicks'),
      align: 'right',
      render: (row) => row.clicks,
    },
  ];
  const dayColumns: Column<(typeof r.daily)[number]>[] = [
    {
      key: 'day',
      header: t('advertiser.report.day'),
      render: (row) => formatDate(`${row.day}T12:00:00+01:00`),
    },
    {
      key: 'views',
      header: t('advertiser.report.impressions'),
      align: 'right',
      render: (row) => row.impressions,
    },
    {
      key: 'taps',
      header: t('advertiser.report.clicks'),
      align: 'right',
      render: (row) => row.clicks,
    },
  ];
  return (
    <Panel title={t('advertiser.report.title')}>
      {r.impressions === 0 ? <p className="sz-muted">{t('advertiser.report.empty')}</p> : null}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 16,
        }}
      >
        <StatCard label={t('advertiser.report.impressions')} value={r.impressions} />
        <StatCard label={t('advertiser.report.clicks')} value={r.clicks} />
        <StatCard label={t('advertiser.report.ctr')} value={`${r.ctr}%`} />
        <StatCard label={t('advertiser.report.reach')} value={r.uniqueReachEstimate} />
      </div>
      {r.byEstate.length > 0 ? (
        <>
          <DataTable
            caption={t('advertiser.report.byEstate')}
            columns={estateColumns}
            rows={r.byEstate}
            rowKey={(row) => row.estateName}
          />
          <p className="sz-muted" style={{ fontSize: 13 }}>
            {t('advertiser.report.threshold', { count: r.minimumAudience })}
          </p>
          <DataTable
            caption={t('advertiser.report.day')}
            columns={dayColumns}
            rows={r.daily}
            rowKey={(row) => row.day}
          />
        </>
      ) : null}
    </Panel>
  );
}

/** One campaign for its advertiser: plan, creatives (submit and change), results, invoices. */
export function CampaignDetailScreen({ id }: { id: string }) {
  const { advertiserId, can, advertiser } = useAdvertiser();
  const [dialog, setDialog] = useState<{ revising: Creative | null } | null>(null);
  const campaign = useQuery({
    queryKey: ['advertiser', advertiserId, 'campaign', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/campaigns/{id}', {
          params: { path: { advertiserId, id } },
        }),
      ),
  });
  if (campaign.isPending) return <Skeleton height={200} />;
  if (campaign.isError)
    return (
      <ErrorState message={errorText(campaign.error)} onRetry={() => void campaign.refetch()} />
    );
  const c = campaign.data;
  const editable =
    can('advertiser.creative.manage') &&
    advertiser.status === 'active' &&
    !['completed', 'cancelled'].includes(c.status);
  return (
    <>
      <p>
        <Link href="/advertiser">{t('advertiser.detail.back')}</Link>
      </p>
      <PageHeader
        title={c.title}
        description={c.objective}
        actions={<StatusPill tone={campaignTone(c.status)} label={campaignStatusLabel(c.status)} />}
      />
      <div style={{ display: 'grid', gap: 16 }}>
        {c.status === 'rejected' && c.rejectionReason ? (
          <Banner tone="warning">
            {t('advertiser.detail.rejected', { reason: c.rejectionReason })}
          </Banner>
        ) : null}
        <Panel>
          <DetailList
            items={[
              {
                label: t('advertiser.campaigns.col.runs'),
                value: t('advertiser.campaigns.runs', {
                  from: formatDate(c.startsAt),
                  to: formatDate(c.endsAt),
                }),
              },
              { label: t('advertiser.detail.budget'), value: formatKobo(c.budgetKobo) },
              ...c.lineItems.map((line) => ({
                label: t(`ads.placement.${line.placementKey}` as MessageKey),
                value:
                  line.targeting.scope === 'all'
                    ? t('advertiser.detail.scope.all')
                    : line.targeting.scope === 'states'
                      ? t('advertiser.detail.scope.states', {
                          states: line.targeting.states.join(', '),
                        })
                      : t('advertiser.detail.scope.estates', {
                          count: line.targeting.estateIds.length,
                        }),
              })),
            ]}
          />
        </Panel>
        <Panel
          title={t('advertiser.creatives.title')}
          actions={
            editable ? (
              <ActionButton size="sm" icon="plus" onClick={() => setDialog({ revising: null })}>
                {t('advertiser.creatives.add')}
              </ActionButton>
            ) : null
          }
        >
          {c.creatives.length === 0 ? (
            <p className="sz-muted">{t('advertiser.creatives.empty')}</p>
          ) : null}
          <div style={{ display: 'grid', gap: 12 }}>
            {c.creatives.map((creative) => (
              <div key={creative.id} className="sz-card" style={{ display: 'grid', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>{creative.headline}</strong>
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
                </div>
                <span className="sz-muted" style={{ fontSize: 13 }}>
                  {t(`admin.ads.creatives.type.${creative.type}`)} ·{' '}
                  {t('advertiser.creatives.version', { version: creative.version })} ·{' '}
                  {creative.destinationUrl}
                </span>
                {creative.body ? <p style={{ margin: 0 }}>{creative.body}</p> : null}
                {creative.reviewNotes ? (
                  <Banner tone="warning">
                    {t('advertiser.creatives.notes', { notes: creative.reviewNotes })}
                  </Banner>
                ) : null}
                {editable ? (
                  <div>
                    <ActionButton
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog({ revising: creative })}
                    >
                      {t('advertiser.creatives.revise')}
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
        <Results campaignId={c.id} />
        {can('advertiser.invoice.pay') || can('advertiser.campaign.read') ? (
          <Invoices campaignId={c.id} />
        ) : null}
      </div>
      {dialog ? (
        <CreativeDialog
          campaignId={c.id}
          revising={dialog.revising}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
