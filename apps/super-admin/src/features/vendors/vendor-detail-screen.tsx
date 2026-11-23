'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  DetailList,
  Dialog,
  ErrorState,
  FormError,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

type DecisionAction = 'approve' | 'reject' | 'suspend' | 'reinstate';

/** Vendor verification, approval and suspension detail (super-admin.md §6.5). */
export function VendorDetailScreen({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const [action, setAction] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState('');

  const categories = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => unwrap(api.GET('/v1/marketplace/categories')),
    staleTime: 10 * 60_000,
  });
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  const vendor = useQuery({
    queryKey: ['platform', 'vendor', id],
    queryFn: () => unwrap(api.GET('/v1/platform/vendors/{id}', { params: { path: { id } } })),
  });

  const decide = useMutation({
    mutationFn: async (kind: DecisionAction) => {
      const trimmed = reason.trim();
      if (kind === 'approve') {
        return unwrap(
          api.POST('/v1/platform/vendors/{id}/approve', {
            params: { path: { id } },
            body: trimmed ? { reason: trimmed } : {},
          }),
        );
      }
      if (kind === 'reinstate') {
        return unwrap(
          api.POST('/v1/platform/vendors/{id}/reinstate', {
            params: { path: { id } },
            body: trimmed ? { reason: trimmed } : {},
          }),
        );
      }
      if (kind === 'reject') {
        return unwrap(
          api.POST('/v1/platform/vendors/{id}/reject', {
            params: { path: { id } },
            body: { reason: trimmed },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/platform/vendors/{id}/suspend', {
          params: { path: { id } },
          body: { reason: trimmed },
        }),
      );
    },
    onSuccess: () => {
      setAction(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['platform', 'vendor', id] });
      void qc.invalidateQueries({ queryKey: ['platform', 'vendors'] });
    },
  });

  if (vendor.isPending) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton height={36} width={260} />
        <Skeleton height={180} />
      </div>
    );
  }
  if (vendor.isError) {
    return <ErrorState message={errorText(vendor.error)} onRetry={() => void vendor.refetch()} />;
  }

  const v = vendor.data;
  const canManage = can('vendor.approve');
  const needsReason = action === 'reject' || action === 'suspend';
  const areas = v.serviceAreas.map((a) =>
    [a.lga, a.state, a.estateId ? `Estate ${a.estateId.slice(0, 8)}` : null]
      .filter(Boolean)
      .join(', '),
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title={v.name}
        description={v.description}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusPill tone={statusTone(v.status)} label={humanizeStatus(v.status)} />
            <Link href="/vendors">
              <ActionButton variant="outline">{t('admin.vendors.detail.back')}</ActionButton>
            </Link>
          </div>
        }
      />

      {v.rejectionReason ? (
        <Banner tone="danger">
          {t('admin.vendors.detail.reject')}: {v.rejectionReason}
        </Banner>
      ) : null}
      {v.suspendedReason ? (
        <Banner tone="danger">
          {t('admin.vendors.detail.suspend')}: {v.suspendedReason}
        </Banner>
      ) : null}

      <Panel title={t('admin.vendors.detail.profile')}>
        <DetailList
          items={[
            { label: t('admin.vendors.detail.type'), value: humanizeStatus(v.type) },
            { label: t('admin.vendors.tier'), value: humanizeStatus(v.verificationTier) },
            { label: t('admin.vendors.detail.cac'), value: v.cacNumber ?? '-' },
            { label: t('admin.vendors.detail.email'), value: v.contactEmail },
            {
              label: t('admin.vendors.categories'),
              value: v.categoryIds.map((cid) => categoryNames.get(cid) ?? cid).join(', ') || '-',
            },
            {
              label: t('admin.vendors.payout'),
              value: v.payout.ready
                ? `${v.payout.bankName ?? 'Bank'} ····${v.payout.accountLast4 ?? ''}`
                : t('admin.vendors.payoutPending'),
            },
            {
              label: t('admin.vendors.detail.rating'),
              value: v.ratingAvg !== null ? `${v.ratingAvg.toFixed(1)} (${v.ratingCount})` : '-',
            },
            { label: t('admin.vendors.created'), value: formatWat(v.createdAt) },
          ]}
        />
      </Panel>

      <Panel title={t('admin.vendors.detail.areas')}>
        {areas.length === 0 ? (
          <p className="sz-muted">-</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {areas.map((area, idx) => (
              <li key={idx}>{area}</li>
            ))}
          </ul>
        )}
      </Panel>

      {canManage ? (
        <Panel title={t('admin.vendors.detail.actions')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {v.status === 'applied' || v.status === 'under_review' || v.status === 'rejected' ? (
              <ActionButton
                onClick={() => {
                  decide.reset();
                  setReason('');
                  setAction('approve');
                }}
              >
                {t('admin.vendors.detail.approve')}
              </ActionButton>
            ) : null}
            {v.status === 'applied' || v.status === 'under_review' ? (
              <ActionButton
                variant="danger"
                onClick={() => {
                  decide.reset();
                  setReason('');
                  setAction('reject');
                }}
              >
                {t('admin.vendors.detail.reject')}
              </ActionButton>
            ) : null}
            {v.status === 'approved' ? (
              <ActionButton
                variant="danger"
                onClick={() => {
                  decide.reset();
                  setReason('');
                  setAction('suspend');
                }}
              >
                {t('admin.vendors.detail.suspend')}
              </ActionButton>
            ) : null}
            {v.status === 'suspended' ? (
              <ActionButton
                onClick={() => {
                  decide.reset();
                  setReason('');
                  setAction('reinstate');
                }}
              >
                {t('admin.vendors.detail.reinstate')}
              </ActionButton>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {action ? (
        <Dialog
          title={t(`admin.vendors.detail.${action}`)}
          onClose={() => setAction(null)}
          onSubmit={() => decide.mutate(action)}
          actions={
            <>
              <ActionButton variant="text" onClick={() => setAction(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                variant={needsReason ? 'danger' : 'primary'}
                busy={decide.isPending}
                disabled={needsReason && reason.trim().length < 3}
              >
                {t(`admin.vendors.detail.${action}`)}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <TextAreaField
              label={
                needsReason
                  ? t('admin.vendors.detail.reason')
                  : t('admin.vendors.detail.optionalReason')
              }
              value={reason}
              onChange={setReason}
              rows={3}
              maxLength={500}
            />
            <FormError message={decide.isError ? errorText(decide.error) : null} />
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
