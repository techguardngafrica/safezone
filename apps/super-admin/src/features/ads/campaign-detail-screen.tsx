'use client';

import { type ApiData, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ConfirmDialog,
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
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatMoney, formatWat, humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

type Campaign = ApiData<'/v1/platform/ad-campaigns/{id}', 'get'>;
type Creative = Campaign['creatives'][number];
type CreativeType = Creative['type'];
type Action = 'submit' | 'reject' | 'pause' | 'resume' | 'cancel';

function CreativeDialog({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<CreativeType>('image_banner');
  const [imageFileId, setImageFileId] = useState('');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [cta, setCta] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('https://');
  const add = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/ad-campaigns/{id}/creatives', {
          params: { path: { id: campaignId } },
          body: {
            type,
            ...(imageFileId.trim() ? { imageFileId: imageFileId.trim() } : {}),
            headline: headline.trim(),
            ...(body.trim() ? { body: body.trim() } : {}),
            cta: cta.trim(),
            destinationUrl: destinationUrl.trim(),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'ad-campaign', campaignId] });
      onClose();
    },
  });
  return (
    <Dialog
      title={t('admin.ads.creatives.add')}
      onClose={onClose}
      onSubmit={() => add.mutate()}
      wide
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('admin.ads.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={add.isPending}>
            {t('admin.ads.creatives.add')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
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
        <FormError message={add.isError ? errorText(add.error) : null} />
      </div>
    </Dialog>
  );
}

function CreativeCard({
  creative,
  campaignId,
  canReview,
}: {
  creative: Creative;
  campaignId: string;
  canReview: boolean;
}) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<'rejected' | 'revision_requested' | null>(null);
  const review = useMutation({
    mutationFn: (input: {
      decision: 'approved' | 'rejected' | 'revision_requested';
      notes?: string;
    }) =>
      unwrap(
        api.POST('/v1/platform/ad-creatives/{id}/review', {
          params: { path: { id: creative.id } },
          body: input,
        }),
      ),
    onSuccess: () => {
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'ad-campaign', campaignId] });
    },
  });
  return (
    <div className="sz-card" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong>{creative.headline}</strong>
        <StatusPill
          tone={statusTone(creative.reviewStatus)}
          label={humanizeStatus(creative.reviewStatus)}
        />
      </div>
      <div className="sz-muted" style={{ fontSize: 13 }}>
        {t(`admin.ads.creatives.type.${creative.type}`)} ·{' '}
        {t('admin.ads.creatives.version', { version: creative.version })}
      </div>
      {creative.body ? <p style={{ margin: 0 }}>{creative.body}</p> : null}
      <DetailList
        items={[
          { label: t('admin.ads.creatives.cta'), value: creative.cta },
          {
            label: t('admin.ads.creatives.destination'),
            value: (
              <a href={creative.destinationUrl} target="_blank" rel="noopener noreferrer nofollow">
                {creative.destinationUrl}
              </a>
            ),
          },
          ...(creative.imageFileId
            ? [{ label: t('admin.ads.creatives.image'), value: creative.imageFileId }]
            : []),
          ...(creative.reviewNotes
            ? [{ label: t('admin.ads.creatives.reviewNotes'), value: creative.reviewNotes }]
            : []),
        ]}
      />
      {canReview && creative.reviewStatus === 'pending' ? (
        <>
          <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
            {t('admin.ads.creatives.checkLabel')}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ActionButton
              size="sm"
              busy={review.isPending}
              onClick={() => review.mutate({ decision: 'approved' })}
            >
              {t('admin.ads.creatives.approve')}
            </ActionButton>
            <ActionButton
              size="sm"
              variant="outline"
              onClick={() => setAsking('revision_requested')}
            >
              {t('admin.ads.creatives.requestChanges')}
            </ActionButton>
            <ActionButton size="sm" variant="text" onClick={() => setAsking('rejected')}>
              {t('admin.ads.creatives.reject')}
            </ActionButton>
          </div>
        </>
      ) : null}
      <FormError message={review.isError && !asking ? errorText(review.error) : null} />
      {asking ? (
        <ConfirmDialog
          title={
            asking === 'rejected'
              ? t('admin.ads.creatives.reject')
              : t('admin.ads.creatives.requestChanges')
          }
          body={creative.headline}
          confirmLabel={
            asking === 'rejected'
              ? t('admin.ads.creatives.reject')
              : t('admin.ads.creatives.requestChanges')
          }
          destructive={asking === 'rejected'}
          reason={{ label: t('admin.ads.creatives.reviewNotes'), required: true }}
          busy={review.isPending}
          error={review.isError ? errorText(review.error) : null}
          onConfirm={(notes) => review.mutate({ decision: asking, notes })}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

function Invoices({ campaign, canManage }: { campaign: Campaign; canManage: boolean }) {
  const qc = useQueryClient();
  const invoices = useQuery({
    queryKey: ['platform', 'ad-campaign', campaign.id, 'invoices'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/ad-campaigns/{id}/invoices', {
          params: { path: { id: campaign.id } },
        }),
      ),
  });
  const issue = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/v1/platform/ad-invoices', { body: { campaignId: campaign.id } })),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['platform', 'ad-campaign', campaign.id] }),
  });
  const open = invoices.data?.some((i) => i.status !== 'void');
  return (
    <Panel
      title={t('admin.ads.invoices.title')}
      actions={
        canManage &&
        invoices.data &&
        !open &&
        !['cancelled', 'rejected'].includes(campaign.status) ? (
          <ActionButton size="sm" busy={issue.isPending} onClick={() => issue.mutate()}>
            {t('admin.ads.invoices.create')}
          </ActionButton>
        ) : null
      }
    >
      {invoices.isPending ? <Skeleton height={40} /> : null}
      {invoices.data?.length === 0 ? (
        <p className="sz-muted">{t('admin.ads.invoices.empty')}</p>
      ) : null}
      {invoices.data?.map((invoice) => (
        <div
          key={invoice.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            padding: '8px 0',
          }}
        >
          <div>
            <strong>{invoice.number}</strong>
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {t('admin.ads.invoices.amount', {
                amount: formatMoney(invoice.amountKobo),
                vat: formatMoney(invoice.vatKobo),
                total: formatMoney(invoice.totalKobo),
              })}
            </div>
          </div>
          <StatusPill tone={statusTone(invoice.status)} label={humanizeStatus(invoice.status)} />
        </div>
      ))}
      <FormError
        message={
          issue.isError
            ? errorText(issue.error)
            : invoices.isError
              ? errorText(invoices.error)
              : null
        }
      />
    </Panel>
  );
}

function Delivery({ campaignId }: { campaignId: string }) {
  const report = useQuery({
    queryKey: ['platform', 'ad-campaign', campaignId, 'report'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/ad-campaigns/{id}/report', { params: { path: { id: campaignId } } }),
      ),
  });
  if (report.isPending) return <Skeleton height={80} />;
  if (report.isError) return <FormError message={errorText(report.error)} />;
  const data = report.data;
  return (
    <Panel title={t('admin.ads.report.title')}>
      {data.impressions === 0 ? <p className="sz-muted">{t('admin.ads.report.empty')}</p> : null}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        <StatCard label={t('admin.ads.report.impressions')} value={data.impressions} />
        <StatCard label={t('admin.ads.report.clicks')} value={data.clicks} />
        <StatCard label={t('admin.ads.report.ctr')} value={`${data.ctr}%`} />
        <StatCard label={t('admin.ads.report.reach')} value={data.uniqueReachEstimate} />
      </div>
    </Panel>
  );
}

/** One campaign: status actions with the approval gates, ARCON reference, creatives, invoices, delivery. */
export function CampaignDetailScreen({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const canManage = can('ad.campaign.manage');
  const canReview = can('ad.campaign.review');
  const key = ['platform', 'ad-campaign', id];
  const [arcon, setArcon] = useState<string | null>(null);
  const [restrictedNote, setRestrictedNote] = useState('');
  const [confirm, setConfirm] = useState<'reject' | 'cancel' | 'credit' | null>(null);
  const [addingCreative, setAddingCreative] = useState(false);
  const campaign = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/v1/platform/ad-campaigns/{id}', { params: { path: { id } } })),
  });
  const refresh = (data: Campaign) => {
    qc.setQueryData(key, data);
    void qc.invalidateQueries({ queryKey: ['platform', 'ad-campaigns'] });
  };
  const action = useMutation({
    mutationFn: ({ name, reason }: { name: Action; reason?: string }) =>
      unwrap(
        api.POST('/v1/platform/ad-campaigns/{id}/{action}', {
          params: { path: { id, action: name } },
          body: reason ? { reason } : {},
        }),
      ),
    onSuccess: (data) => {
      setConfirm(null);
      refresh(data);
    },
  });
  const approve = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/ad-campaigns/{id}/approve', {
          params: { path: { id } },
          body: restrictedNote.trim() ? { restrictedNote: restrictedNote.trim() } : {},
        }),
      ),
    onSuccess: refresh,
  });
  const credit = useMutation({
    mutationFn: (note: string) =>
      unwrap(
        api.POST('/v1/platform/ad-campaigns/{id}/credit', {
          params: { path: { id } },
          body: { note },
        }),
      ),
    onSuccess: (data) => {
      setConfirm(null);
      refresh(data);
    },
  });
  const saveArcon = useMutation({
    mutationFn: (ref: string) =>
      unwrap(
        api.PATCH('/v1/platform/ad-campaigns/{id}', {
          params: { path: { id } },
          body: { arconApprovalRef: ref },
        }),
      ),
    onSuccess: (data) => {
      setArcon(null);
      refresh(data);
    },
  });

  if (campaign.isPending) return <Skeleton height={240} />;
  if (campaign.isError)
    return (
      <ErrorState message={errorText(campaign.error)} onRetry={() => void campaign.refetch()} />
    );
  const c = campaign.data;
  const s = c.status;
  const inReview = s === 'submitted' || s === 'under_review';
  const actionError = action.error ?? approve.error ?? saveArcon.error;

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.advertiserName}
        actions={<StatusPill tone={statusTone(s)} label={humanizeStatus(s)} />}
      />
      <div style={{ display: 'grid', gap: 16 }}>
        {c.rejectionReason && s === 'rejected' ? (
          <Banner tone="danger">
            {t('admin.ads.campaigns.rejection', { reason: c.rejectionReason })}
          </Banner>
        ) : null}
        <Panel>
          <DetailList
            items={[
              { label: t('admin.ads.campaigns.objective'), value: c.objective },
              {
                label: t('admin.ads.campaigns.flight'),
                value: `${formatWat(c.startsAt)} to ${formatWat(c.endsAt)}`,
              },
              { label: t('admin.ads.budget'), value: formatMoney(c.budgetKobo) },
              {
                label: t('admin.ads.campaigns.paid'),
                value: c.paid
                  ? t('admin.ads.campaigns.paid')
                  : c.creditApproved
                    ? t('admin.ads.campaigns.credit')
                    : t('admin.ads.campaigns.unpaid'),
              },
              { label: t('admin.ads.campaigns.arcon'), value: c.arconApprovalRef ?? '-' },
              ...c.lineItems.map((line) => ({
                label: line.placementKey,
                value:
                  line.targeting.scope === 'all'
                    ? t('admin.ads.campaigns.scope.all')
                    : line.targeting.scope === 'states'
                      ? `${t('admin.ads.campaigns.scope.states')}: ${line.targeting.states.join(', ')}`
                      : `${t('admin.ads.campaigns.scope.estates')}: ${line.targeting.estateIds.length}`,
              })),
            ]}
          />
          {!c.arconApprovalRef ? (
            <Banner tone="warning">{t('admin.ads.campaigns.arconMissing')}</Banner>
          ) : null}
          {canManage && !['completed', 'cancelled'].includes(s) ? (
            <form
              className="sz-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (arcon && arcon.trim().length >= 3) saveArcon.mutate(arcon.trim());
              }}
            >
              <InputField
                label={t('admin.ads.campaigns.arcon')}
                value={arcon ?? c.arconApprovalRef ?? ''}
                onChange={setArcon}
                maxLength={80}
              />
              <div>
                <ActionButton
                  type="submit"
                  variant="outline"
                  size="sm"
                  busy={saveArcon.isPending}
                  disabled={!arcon || arcon.trim().length < 3}
                >
                  {t('admin.ads.campaigns.saveArcon')}
                </ActionButton>
              </div>
            </form>
          ) : null}
        </Panel>

        <Panel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canManage && (s === 'draft' || s === 'rejected') ? (
              <ActionButton
                busy={action.isPending}
                onClick={() => action.mutate({ name: 'submit' })}
              >
                {t('admin.ads.campaigns.submit')}
              </ActionButton>
            ) : null}
            {canReview && inReview ? (
              <ActionButton busy={approve.isPending} onClick={() => approve.mutate()}>
                {t('admin.ads.campaigns.approve')}
              </ActionButton>
            ) : null}
            {canReview && (inReview || s === 'awaiting_payment') ? (
              <ActionButton variant="outline" onClick={() => setConfirm('reject')}>
                {t('admin.ads.campaigns.reject')}
              </ActionButton>
            ) : null}
            {canReview &&
            !c.paid &&
            !c.creditApproved &&
            !['completed', 'cancelled', 'rejected'].includes(s) ? (
              <ActionButton variant="outline" onClick={() => setConfirm('credit')}>
                {t('admin.ads.campaigns.approveCredit')}
              </ActionButton>
            ) : null}
            {(canManage || canReview) && (s === 'active' || s === 'scheduled') ? (
              <ActionButton variant="outline" onClick={() => action.mutate({ name: 'pause' })}>
                {t('admin.ads.campaigns.pause')}
              </ActionButton>
            ) : null}
            {(canManage || canReview) && s === 'paused' ? (
              <ActionButton onClick={() => action.mutate({ name: 'resume' })}>
                {t('admin.ads.campaigns.resume')}
              </ActionButton>
            ) : null}
            {(canManage || canReview) && !['completed', 'cancelled', 'rejected'].includes(s) ? (
              <ActionButton variant="text" onClick={() => setConfirm('cancel')}>
                {t('admin.ads.campaigns.cancelCampaign')}
              </ActionButton>
            ) : null}
          </div>
          {canReview && inReview ? (
            <TextAreaField
              label={`${t('admin.ads.campaigns.restrictedNote')} ${t('admin.ads.optional')}`}
              value={restrictedNote}
              onChange={setRestrictedNote}
              rows={2}
              maxLength={1000}
            />
          ) : null}
          <FormError message={actionError ? errorText(actionError) : null} />
        </Panel>

        <Panel
          title={t('admin.ads.creatives.title')}
          actions={
            canManage && !['completed', 'cancelled'].includes(s) ? (
              <ActionButton size="sm" icon="plus" onClick={() => setAddingCreative(true)}>
                {t('admin.ads.creatives.add')}
              </ActionButton>
            ) : null
          }
        >
          {c.creatives.length === 0 ? (
            <p className="sz-muted">{t('admin.ads.creatives.empty')}</p>
          ) : null}
          <div style={{ display: 'grid', gap: 12 }}>
            {c.creatives.map((creative) => (
              <CreativeCard
                key={creative.id}
                creative={creative}
                campaignId={c.id}
                canReview={canReview}
              />
            ))}
          </div>
        </Panel>

        <Invoices campaign={c} canManage={canManage} />
        <Delivery campaignId={c.id} />
      </div>
      {addingCreative ? (
        <CreativeDialog campaignId={c.id} onClose={() => setAddingCreative(false)} />
      ) : null}
      {confirm === 'reject' || confirm === 'cancel' ? (
        <ConfirmDialog
          title={
            confirm === 'reject'
              ? t('admin.ads.campaigns.rejectTitle')
              : t('admin.ads.campaigns.cancelTitle')
          }
          body={
            confirm === 'reject'
              ? t('admin.ads.campaigns.rejectBody')
              : t('admin.ads.campaigns.cancelBody')
          }
          confirmLabel={
            confirm === 'reject'
              ? t('admin.ads.campaigns.reject')
              : t('admin.ads.campaigns.cancelCampaign')
          }
          destructive
          reason={{ label: t('admin.ads.reason'), required: true }}
          busy={action.isPending}
          error={action.isError ? errorText(action.error) : null}
          onConfirm={(reason) => action.mutate({ name: confirm, reason })}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {confirm === 'credit' ? (
        <ConfirmDialog
          title={t('admin.ads.campaigns.creditTitle')}
          body={t('admin.ads.campaigns.creditBody')}
          confirmLabel={t('admin.ads.campaigns.approveCredit')}
          reason={{ label: t('admin.ads.campaigns.creditNote'), required: true }}
          busy={credit.isPending}
          error={credit.isError ? errorText(credit.error) : null}
          onConfirm={(note) => credit.mutate(note)}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
