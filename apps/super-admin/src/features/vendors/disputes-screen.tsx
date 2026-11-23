'use client';

import { type ApiData, unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  DetailList,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatMoney, formatWat, humanizeStatus, statusTone } from '../../lib/format';

type Dispute = ApiData<'/v1/platform/order-disputes', 'get'>[number];
type Resolution = 'refund' | 'partial_refund' | 'no_action';

/** Marketplace order disputes across estates (super-admin.md §6.5). */
export function DisputesScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved' | ''>('open');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState<Resolution>('no_action');
  const [refundNaira, setRefundNaira] = useState('');
  const [note, setNote] = useState('');

  const query = useQuery({
    queryKey: ['platform', 'order-disputes', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/order-disputes', {
          params: {
            query: {
              limit: 25,
              ...(status ? { status } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => {
      const kobo = Math.round(Number(refundNaira) * 100);
      return unwrap(
        api.POST('/v1/platform/order-disputes/{id}/resolve', {
          params: { path: { id } },
          body: {
            resolution,
            ...(resolution === 'partial_refund' ? { refundKobo: kobo } : {}),
            note: note.trim(),
          },
        }),
      );
    },
    onSuccess: () => {
      setSelected(null);
      setNote('');
      setRefundNaira('');
      void qc.invalidateQueries({ queryKey: ['platform', 'order-disputes'] });
    },
  });

  const canResolve =
    note.trim().length >= 3 &&
    (resolution !== 'partial_refund' ||
      (Number.isFinite(Number(refundNaira)) && Number(refundNaira) > 0));

  return (
    <>
      <PageHeader
        title={t('admin.vendors.disputes.title')}
        description={t('admin.vendors.disputes.description')}
      />
      <Toolbar>
        <SelectField
          label={t('admin.vendors.status')}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: t('admin.vendors.allStatuses') },
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.vendors.disputes.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => {
            resolve.reset();
            setResolution('no_action');
            setRefundNaira('');
            setNote('');
            setSelected(row);
          }}
          empty={{ icon: 'shield', title: t('admin.vendors.disputes.empty') }}
          columns={[
            {
              key: 'order',
              header: t('admin.vendors.disputes.order'),
              render: (row) => (
                <div>
                  <code>{row.orderId.slice(0, 8)}</code>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    Vendor {row.vendorId.slice(0, 8)}
                  </div>
                </div>
              ),
            },
            {
              key: 'reason',
              header: t('admin.vendors.disputes.reason'),
              render: (row) => row.reason,
            },
            {
              key: 'status',
              header: t('admin.vendors.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'resolution',
              header: t('admin.vendors.disputes.resolution'),
              render: (row) => (row.resolution ? humanizeStatus(row.resolution) : '-'),
            },
            {
              key: 'refund',
              header: t('admin.vendors.disputes.refund'),
              align: 'right',
              render: (row) => (row.refundKobo ? formatMoney(row.refundKobo) : '-'),
            },
            {
              key: 'created',
              header: t('admin.vendors.created'),
              render: (row) => formatWat(row.createdAt),
            },
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

      {selected ? (
        <Dialog
          title={
            selected.status === 'open'
              ? t('admin.vendors.disputes.resolve')
              : t('admin.vendors.disputes.title')
          }
          wide
          onClose={() => setSelected(null)}
          onSubmit={selected.status === 'open' ? () => resolve.mutate(selected.id) : undefined}
          actions={
            <>
              <ActionButton variant="text" onClick={() => setSelected(null)}>
                {t('common.close')}
              </ActionButton>
              {selected.status === 'open' ? (
                <ActionButton type="submit" busy={resolve.isPending} disabled={!canResolve}>
                  {t('admin.vendors.disputes.resolve')}
                </ActionButton>
              ) : null}
            </>
          }
        >
          <div className="sz-form">
            <DetailList
              items={[
                { label: t('admin.vendors.disputes.order'), value: selected.orderId },
                { label: 'Vendor ID', value: selected.vendorId },
                { label: 'Estate ID', value: selected.estateId },
                { label: t('admin.vendors.disputes.reason'), value: selected.reason },
                {
                  label: t('admin.vendors.disputes.evidence'),
                  value: selected.evidenceFileIds.length
                    ? selected.evidenceFileIds.join(', ')
                    : '-',
                },
                ...(selected.status === 'resolved'
                  ? [
                      {
                        label: t('admin.vendors.disputes.resolution'),
                        value: selected.resolution ? humanizeStatus(selected.resolution) : '-',
                      },
                      {
                        label: t('admin.vendors.disputes.refund'),
                        value: selected.refundKobo ? formatMoney(selected.refundKobo) : '-',
                      },
                      { label: t('admin.vendors.disputes.note'), value: selected.note ?? '-' },
                      { label: 'Resolved at', value: formatWat(selected.resolvedAt) },
                    ]
                  : []),
              ]}
            />
            {selected.status === 'open' ? (
              <>
                <SelectField
                  label={t('admin.vendors.disputes.resolution')}
                  value={resolution}
                  onChange={setResolution}
                  options={[
                    { value: 'no_action', label: 'No action' },
                    { value: 'partial_refund', label: 'Partial refund' },
                    { value: 'refund', label: 'Full refund' },
                  ]}
                />
                {resolution === 'partial_refund' ? (
                  <InputField
                    label={t('admin.vendors.disputes.refundNaira')}
                    type="number"
                    value={refundNaira}
                    onChange={setRefundNaira}
                  />
                ) : null}
                <TextAreaField
                  label={t('admin.vendors.disputes.note')}
                  value={note}
                  onChange={setNote}
                  rows={3}
                  maxLength={1000}
                />
                <FormError message={resolve.isError ? errorText(resolve.error) : null} />
              </>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
