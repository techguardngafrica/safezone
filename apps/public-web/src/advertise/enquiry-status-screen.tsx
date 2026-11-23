'use client';

import { ApiClientError, unwrap } from '@safezone/api-client';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import { Banner, ErrorState, Panel, Skeleton, StatusPill, type Tone } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';

const STATUS_TONE: Record<string, Tone> = {
  submitted: 'info',
  under_review: 'info',
  awaiting_information: 'warning',
  proposal_sent: 'info',
  negotiation: 'info',
  approved: 'success',
  rejected: 'danger',
  converted_to_campaign: 'success',
};

const MILESTONES: { key: MessageKey; reached: Set<string> }[] = [
  {
    key: 'public.advertise.status.step.submitted',
    reached: new Set([
      'submitted',
      'under_review',
      'awaiting_information',
      'proposal_sent',
      'negotiation',
      'approved',
      'converted_to_campaign',
    ]),
  },
  {
    key: 'public.advertise.status.step.review',
    reached: new Set([
      'under_review',
      'awaiting_information',
      'proposal_sent',
      'negotiation',
      'approved',
      'converted_to_campaign',
    ]),
  },
  {
    key: 'public.advertise.status.step.proposal',
    reached: new Set(['proposal_sent', 'negotiation', 'approved', 'converted_to_campaign']),
  },
  {
    key: 'public.advertise.status.step.approved',
    reached: new Set(['approved', 'converted_to_campaign']),
  },
  {
    key: 'public.advertise.status.step.campaign',
    reached: new Set(['converted_to_campaign']),
  },
];

/** Link-based advertising enquiry status tracker (public-web.md §7). */
export function EnquiryStatusScreen({ token }: { token: string }) {
  const enquiry = useQuery({
    queryKey: ['public', 'ad-enquiry', token],
    queryFn: () =>
      unwrap(api.GET('/v1/public/ad-enquiries/{token}', { params: { path: { token } } })),
    retry: false,
  });

  if (enquiry.isPending) {
    return (
      <div style={{ display: 'grid', gap: 12 }} role="status" aria-label={t('common.loading')}>
        <Skeleton height={80} />
        <Skeleton height={160} />
      </div>
    );
  }

  if (enquiry.isError) {
    const isNotFound = enquiry.error instanceof ApiClientError && enquiry.error.statusCode === 404;
    if (isNotFound) {
      return (
        <Panel>
          <div style={{ display: 'grid', gap: 12 }}>
            <Banner tone="warning">{t('public.advertise.status.notFound')}</Banner>
            <div>
              <Link href="/advertise">{t('public.advertise.status.backToAdvertise')}</Link>
            </div>
          </div>
        </Panel>
      );
    }
    return <ErrorState message={errorText(enquiry.error)} onRetry={() => void enquiry.refetch()} />;
  }

  const data = enquiry.data;
  const statusLabel = t(`public.advertise.status.label.${data.status}` as MessageKey);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel
        title={t('public.advertise.status.currentStatus')}
        actions={<StatusPill tone={STATUS_TONE[data.status] ?? 'neutral'} label={statusLabel} />}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          {data.status !== 'rejected' ? (
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {MILESTONES.map((step, index) => {
                const reached = step.reached.has(data.status);
                return (
                  <li
                    key={step.key}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: reached ? 700 : 400,
                      border: '1px solid var(--sz-border, #d0d7de)',
                      opacity: reached ? 1 : 0.55,
                    }}
                  >
                    {index + 1}. {t(step.key)}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {data.hasAdvertiserAccount ? (
            <Banner tone="success">
              <div style={{ display: 'grid', gap: 8 }}>
                <span>{t('public.advertise.status.accountReady')}</span>
                <div>
                  <Link
                    href="/advertiser"
                    className="sz-btn sz-btn-primary"
                    style={{ textDecoration: 'none' }}
                  >
                    {t('public.advertise.status.openPortal')}
                  </Link>
                </div>
              </div>
            </Banner>
          ) : null}
        </div>
      </Panel>

      <Panel title={t('public.advertise.status.summary')}>
        <dl
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            margin: 0,
          }}
        >
          {data.orgName ? (
            <div>
              <dt className="sz-muted" style={{ fontSize: 13 }}>
                {t('public.advertise.form.org')}
              </dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{data.orgName}</dd>
            </div>
          ) : null}
          <div>
            <dt className="sz-muted" style={{ fontSize: 13 }}>
              {t('public.advertise.status.category')}
            </dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>
              {t(`ads.category.${data.category}` as MessageKey)}
            </dd>
          </div>
          <div>
            <dt className="sz-muted" style={{ fontSize: 13 }}>
              {t('public.advertise.status.budget')}
            </dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>
              {t(`public.advertise.budget.${data.budgetRange}` as MessageKey)}
            </dd>
          </div>
          {data.durationWeeks ? (
            <div>
              <dt className="sz-muted" style={{ fontSize: 13 }}>
                {t('public.advertise.status.duration')}
              </dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>
                {t('public.advertise.status.durationWeeks', { weeks: data.durationWeeks })}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="sz-muted" style={{ fontSize: 13 }}>
              {t('public.advertise.status.placements')}
            </dt>
            <dd style={{ margin: 0 }}>
              {data.placements.length > 0
                ? data.placements.map((p) => t(`ads.placement.${p}` as MessageKey)).join(', ')
                : t('public.advertise.status.noneSelected')}
            </dd>
          </div>
          <div>
            <dt className="sz-muted" style={{ fontSize: 13 }}>
              {t('public.advertise.status.submittedAt')}
            </dt>
            <dd style={{ margin: 0 }}>{formatDate(data.createdAt)}</dd>
          </div>
          <div>
            <dt className="sz-muted" style={{ fontSize: 13 }}>
              {t('public.advertise.status.updatedAt')}
            </dt>
            <dd style={{ margin: 0 }}>{formatDate(data.updatedAt)}</dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}
