'use client';

import { type ApiData, unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  Dialog,
  ErrorState,
  FormError,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

type CreativeItem = ApiData<'/v1/platform/ad-creatives', 'get'>[number];
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'revision_requested';

/** Cross-campaign creative review queue (super-admin.md §6.6). */
export function ReviewQueueScreen() {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const [status, setStatus] = useState<ReviewStatus | ''>('pending');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [deciding, setDeciding] = useState<{
    creative: CreativeItem;
    decision: 'rejected' | 'revision_requested';
  } | null>(null);
  const [notes, setNotes] = useState('');

  const query = useQuery({
    queryKey: ['platform', 'ad-creatives', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/ad-creatives', {
          params: {
            query: {
              limit: 25,
              ...(status ? { reviewStatus: status } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const review = useMutation({
    mutationFn: (input: {
      id: string;
      decision: 'approved' | 'rejected' | 'revision_requested';
      notes?: string;
    }) =>
      unwrap(
        api.POST('/v1/platform/ad-creatives/{id}/review', {
          params: { path: { id: input.id } },
          body: { decision: input.decision, ...(input.notes ? { notes: input.notes } : {}) },
        }),
      ),
    onSuccess: () => {
      setDeciding(null);
      setNotes('');
      void qc.invalidateQueries({ queryKey: ['platform', 'ad-creatives'] });
    },
  });

  const canReview = can('ad.campaign.review');

  return (
    <>
      <PageHeader
        title={t('admin.ads.review.title')}
        description={t('admin.ads.review.description')}
      />
      <Toolbar>
        <SelectField
          label={t('admin.ads.status')}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: t('admin.ads.review.allStatuses') },
            { value: 'pending', label: 'Pending' },
            { value: 'revision_requested', label: 'Revision requested' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.ads.review.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'fileCheck', title: t('admin.ads.review.empty') }}
          columns={[
            {
              key: 'creative',
              header: t('admin.ads.review.creative'),
              render: (row) => (
                <div>
                  <strong>{row.headline}</strong>
                  {row.body ? (
                    <div className="sz-muted" style={{ fontSize: 12 }}>
                      {row.body}
                    </div>
                  ) : null}
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    CTA: {row.cta} · {row.destinationUrl}
                  </div>
                </div>
              ),
            },
            {
              key: 'campaign',
              header: t('admin.ads.review.campaign'),
              render: (row) => (
                <div>
                  <Link href={`/ads/campaigns/${row.campaignId}`}>
                    <strong>{row.campaignTitle}</strong>
                  </Link>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.advertiserName} · {humanizeStatus(row.category)}
                  </div>
                </div>
              ),
            },
            {
              key: 'format',
              header: t('admin.ads.review.format'),
              render: (row) => humanizeStatus(row.type),
            },
            {
              key: 'arcon',
              header: t('admin.ads.review.arcon'),
              render: (row) => row.arconApprovalRef ?? '-',
            },
            {
              key: 'status',
              header: t('admin.ads.status'),
              render: (row) => (
                <StatusPill
                  tone={statusTone(row.reviewStatus)}
                  label={humanizeStatus(row.reviewStatus)}
                />
              ),
            },
            ...(canReview
              ? [
                  {
                    key: 'actions',
                    header: t('admin.ads.review.actions'),
                    render: (row: CreativeItem) => (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {row.reviewStatus !== 'approved' ? (
                          <ActionButton
                            size="sm"
                            busy={review.isPending && review.variables?.id === row.id}
                            onClick={() => review.mutate({ id: row.id, decision: 'approved' })}
                          >
                            {t('admin.ads.review.approve')}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            review.reset();
                            setNotes(row.reviewNotes ?? '');
                            setDeciding({ creative: row, decision: 'revision_requested' });
                          }}
                        >
                          {t('admin.ads.review.revise')}
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            review.reset();
                            setNotes(row.reviewNotes ?? '');
                            setDeciding({ creative: row, decision: 'rejected' });
                          }}
                        >
                          {t('admin.ads.review.reject')}
                        </ActionButton>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {query.data?.nextCursor ? (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <ActionButton
            variant="outline"
            onClick={() => setCursor(query.data.nextCursor ?? undefined)}
          >
            {t('ui.loadMore')}
          </ActionButton>
        </div>
      ) : null}

      {deciding ? (
        <Dialog
          title={
            deciding.decision === 'rejected'
              ? t('admin.ads.review.reject')
              : t('admin.ads.review.revise')
          }
          onClose={() => setDeciding(null)}
          onSubmit={() =>
            review.mutate({
              id: deciding.creative.id,
              decision: deciding.decision,
              notes: notes.trim(),
            })
          }
          actions={
            <>
              <ActionButton variant="text" onClick={() => setDeciding(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                variant={deciding.decision === 'rejected' ? 'danger' : 'primary'}
                busy={review.isPending}
                disabled={notes.trim().length < 3}
              >
                {deciding.decision === 'rejected'
                  ? t('admin.ads.review.reject')
                  : t('admin.ads.review.revise')}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <TextAreaField
              label={t('admin.ads.review.notes')}
              value={notes}
              onChange={setNotes}
              rows={3}
              maxLength={1000}
            />
            <FormError message={review.isError ? errorText(review.error) : null} />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
