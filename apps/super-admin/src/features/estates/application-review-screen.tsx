'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ConfirmDialog,
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
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

export function ApplicationReviewScreen({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [reasonMode, setReasonMode] = useState<'request_info' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['platform', 'application', applicationId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/estate-applications/{id}', {
          params: { path: { id: applicationId } },
        }),
      ),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'application', applicationId] });
    void qc.invalidateQueries({ queryKey: ['platform', 'applications'] });
    void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
  };

  const startReview = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/estate-applications/{id}/start-review', {
          params: { path: { id: applicationId } },
        }),
      ),
    onSuccess: invalidate,
    onError: (err) => setActionError(errorText(err)),
  });

  const approve = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/estate-applications/{id}/approve', {
          params: { path: { id: applicationId } },
        }),
      ),
    onSuccess: () => {
      setConfirmApprove(false);
      invalidate();
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const decideWithReason = useMutation({
    mutationFn: async () => {
      if (reasonMode === 'request_info') {
        return unwrap(
          api.POST('/v1/platform/estate-applications/{id}/request-info', {
            params: { path: { id: applicationId } },
            body: { reason },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/platform/estate-applications/{id}/reject', {
          params: { path: { id: applicationId } },
          body: { reason },
        }),
      );
    },
    onSuccess: () => {
      setReasonMode(null);
      setReason('');
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const downloadDoc = async (fileId: string) => {
    setActionError(null);
    try {
      const res = await unwrap(
        api.GET('/v1/platform/estate-applications/{id}/documents/{fileId}/download-url', {
          params: { path: { id: applicationId, fileId } },
        }),
      );
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  if (query.isPending) {
    return (
      <>
        <PageHeader title={t('admin.applications.reviewTitle')} />
        <Skeleton height={160} />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('admin.applications.reviewTitle')} />
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const app = query.data;
  const canStart = app.status === 'submitted';
  const canDecide =
    app.status === 'submitted' || app.status === 'under_review' || app.status === 'info_requested';

  return (
    <>
      <PageHeader
        title={app.estate.name}
        breadcrumbs={<Link href="/estates/applications">{t('admin.applications.title')}</Link>}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canStart ? (
              <ActionButton
                variant="outline"
                disabled={startReview.isPending}
                onClick={() => startReview.mutate()}
              >
                {t('admin.applications.startReview')}
              </ActionButton>
            ) : null}
            {canDecide ? (
              <>
                <ActionButton
                  variant="outline"
                  onClick={() => {
                    setActionError(null);
                    setReason('');
                    setReasonMode('request_info');
                  }}
                >
                  {t('admin.applications.requestInfo')}
                </ActionButton>
                <ActionButton
                  variant="danger"
                  onClick={() => {
                    setActionError(null);
                    setReason('');
                    setReasonMode('reject');
                  }}
                >
                  {t('admin.applications.reject')}
                </ActionButton>
                <ActionButton onClick={() => setConfirmApprove(true)}>
                  {t('admin.applications.approve')}
                </ActionButton>
              </>
            ) : null}
            {app.estateId ? (
              <Link href={`/estates/${app.estateId}`}>
                <ActionButton variant="outline">Open estate</ActionButton>
              </Link>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <div style={{ marginBottom: 16 }}>
          <FormError message={actionError} />
        </div>
      ) : null}

      {app.duplicates.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning">
            <strong>{t('admin.applications.duplicateWarning')}</strong>{' '}
            {app.duplicates
              .map((d) => `${d.kind}: ${d.name} (${humanizeStatus(d.reason)})`)
              .join('; ')}
          </Banner>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <Panel title="Estate details">
          <DetailList
            items={[
              {
                label: 'Status',
                value: (
                  <StatusPill tone={statusTone(app.status)} label={humanizeStatus(app.status)} />
                ),
              },
              { label: 'Type', value: humanizeStatus(app.estate.type) },
              { label: 'Address', value: app.estate.address },
              { label: 'State / LGA', value: `${app.estate.state} / ${app.estate.lga}` },
              { label: 'Estimated units', value: app.estate.unitsEstimate },
              { label: 'Estimated gates', value: app.estate.gatesEstimate },
              { label: 'Submitted', value: formatWat(app.submittedAt) },
              ...(app.decisionReason
                ? [{ label: 'Decision note', value: app.decisionReason }]
                : []),
            ]}
          />
        </Panel>

        <Panel title="Representative">
          <DetailList
            items={[
              { label: 'Full name', value: app.representative.fullName },
              { label: 'Role', value: app.representative.role },
              { label: 'Phone', value: app.applicantPhone },
              { label: 'Email', value: app.representative.email },
              { label: 'User ID', value: app.applicantUserId },
            ]}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title={t('admin.applications.documents')}>
          {app.documents.length === 0 ? (
            <p className="sz-muted">No documents attached.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {app.documents.map((doc) => (
                <div
                  key={doc.fileId}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>
                    {humanizeStatus(doc.docType)} ({doc.fileId.slice(0, 8)})
                  </span>
                  <ActionButton
                    variant="outline"
                    size="sm"
                    icon="download"
                    onClick={() => void downloadDoc(doc.fileId)}
                  >
                    {t('admin.applications.downloadDoc')}
                  </ActionButton>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {confirmApprove ? (
        <ConfirmDialog
          title={t('admin.applications.approve')}
          body={t('admin.applications.approveConfirm')}
          confirmLabel={t('admin.applications.approve')}
          busy={approve.isPending}
          onConfirm={() => approve.mutate()}
          onClose={() => setConfirmApprove(false)}
        />
      ) : null}

      {reasonMode ? (
        <Dialog
          title={
            reasonMode === 'reject'
              ? t('admin.applications.reject')
              : t('admin.applications.requestInfo')
          }
          onClose={() => setReasonMode(null)}
          onSubmit={() => decideWithReason.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setReasonMode(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant={reasonMode === 'reject' ? 'danger' : 'primary'}
                disabled={reason.trim().length < 5 || decideWithReason.isPending}
              >
                Confirm
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <TextAreaField
            label={t('admin.applications.reasonLabel')}
            value={reason}
            onChange={setReason}
            required
            rows={4}
          />
        </Dialog>
      ) : null}
    </>
  );
}
