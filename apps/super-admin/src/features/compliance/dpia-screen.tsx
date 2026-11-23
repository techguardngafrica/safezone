'use client';

import { type ApiData, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

type DpiaRecord = ApiData<'/v1/platform/dpia', 'get'>[number];
type RiskLevel = 'low' | 'medium' | 'high';
type DpiaStatus = 'draft' | 'in_review' | 'approved' | 'requires_update';

/** Data Protection Impact Assessment (DPIA) register (super-admin.md §6.8). */
export function DpiaScreen() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DpiaRecord | null>(null);
  const [title, setTitle] = useState('');
  const [activity, setActivity] = useState('');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('medium');
  const [status, setStatus] = useState<DpiaStatus>('draft');
  const [mitigations, setMitigations] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');

  const list = useQuery({
    queryKey: ['platform', 'dpia'],
    queryFn: () => unwrap(api.GET('/v1/platform/dpia')),
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/dpia', {
          body: {
            title: title.trim(),
            processingActivity: activity.trim(),
            riskLevel,
            mitigations: mitigations.trim(),
            ...(nextReviewDate ? { nextReviewAt: `${nextReviewDate}T00:00:00Z` } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ['platform', 'dpia'] });
    },
  });

  const update = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.PATCH('/v1/platform/dpia/{id}', {
          params: { path: { id } },
          body: {
            title: title.trim(),
            processingActivity: activity.trim(),
            riskLevel,
            status,
            mitigations: mitigations.trim(),
            nextReviewAt: nextReviewDate ? `${nextReviewDate}T00:00:00Z` : null,
          },
        }),
      ),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'dpia'] });
    },
  });

  function openCreate() {
    create.reset();
    setTitle('');
    setActivity('');
    setRiskLevel('medium');
    setStatus('draft');
    setMitigations('');
    setNextReviewDate('');
    setCreating(true);
  }

  function openEdit(row: DpiaRecord) {
    update.reset();
    setTitle(row.title);
    setActivity(row.processingActivity);
    setRiskLevel(row.riskLevel);
    setStatus(row.status);
    setMitigations(row.mitigations);
    setNextReviewDate(row.nextReviewAt ? row.nextReviewAt.slice(0, 10) : '');
    setEditing(row);
  }

  const formValid =
    title.trim().length >= 3 && activity.trim().length >= 5 && mitigations.trim().length >= 5;

  return (
    <>
      <PageHeader
        title={t('admin.compliance.dpia.title')}
        description={t('admin.compliance.dpia.description')}
        actions={
          <ActionButton icon="plus" onClick={openCreate}>
            {t('admin.compliance.dpia.new')}
          </ActionButton>
        }
      />

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.compliance.dpia.title')}
          loading={list.isPending}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          onRowClick={openEdit}
          empty={{ icon: 'shield', title: t('admin.compliance.dpia.empty') }}
          columns={[
            {
              key: 'title',
              header: t('admin.compliance.dpia.titleField'),
              render: (row) => (
                <div>
                  <strong>{row.title}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.processingActivity}
                  </div>
                </div>
              ),
            },
            {
              key: 'risk',
              header: t('admin.compliance.dpia.risk'),
              render: (row) => (
                <StatusPill
                  tone={statusTone(row.riskLevel)}
                  label={humanizeStatus(row.riskLevel)}
                />
              ),
            },
            {
              key: 'status',
              header: t('admin.vendors.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'reviewed',
              header: t('admin.compliance.dpia.reviewed'),
              render: (row) => formatWat(row.reviewedAt),
            },
            {
              key: 'nextReview',
              header: t('admin.compliance.dpia.nextReview'),
              render: (row) => formatWat(row.nextReviewAt),
            },
          ]}
        />
      )}

      {creating || editing ? (
        <Dialog
          title={editing ? t('admin.compliance.dpia.edit') : t('admin.compliance.dpia.new')}
          wide
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={() => {
            if (editing) update.mutate(editing.id);
            else create.mutate();
          }}
          actions={
            <>
              <ActionButton
                variant="text"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                busy={create.isPending || update.isPending}
                disabled={!formValid}
              >
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <InputField
              label={t('admin.compliance.dpia.titleField')}
              value={title}
              onChange={setTitle}
              maxLength={200}
            />
            <TextAreaField
              label={t('admin.compliance.dpia.activity')}
              value={activity}
              onChange={setActivity}
              rows={3}
              maxLength={4000}
            />
            <SelectField
              label={t('admin.compliance.dpia.risk')}
              value={riskLevel}
              onChange={setRiskLevel}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
            {editing ? (
              <SelectField
                label={t('admin.vendors.status')}
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'draft', label: 'Draft' },
                  { value: 'in_review', label: 'In review' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'requires_update', label: 'Requires update' },
                ]}
              />
            ) : null}
            <TextAreaField
              label={t('admin.compliance.dpia.mitigations')}
              value={mitigations}
              onChange={setMitigations}
              rows={3}
              maxLength={4000}
            />
            <InputField
              label={t('admin.compliance.dpia.nextReview')}
              type="date"
              value={nextReviewDate}
              onChange={setNextReviewDate}
            />
            <FormError
              message={
                create.isError
                  ? errorText(create.error)
                  : update.isError
                    ? errorText(update.error)
                    : null
              }
            />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
