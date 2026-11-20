'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Tabs,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Meter = ApiRow<'/v1/estates/{estateId}/meters', 'get'>;
type Outage = ApiRow<'/v1/estates/{estateId}/utility-outages', 'get'>;
type TabId = 'meters' | 'outages';

export function UtilitiesScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('meters');

  const [readingMeter, setReadingMeter] = useState<Meter | null>(null);
  const [readingValue, setReadingValue] = useState('');
  const [announcing, setAnnouncing] = useState(false);
  const [outageType, setOutageType] = useState<
    'electricity' | 'water' | 'gas' | 'internet' | 'waste'
  >('electricity');
  const [outageTitle, setOutageTitle] = useState('');
  const [outageDetails, setOutageDetails] = useState('');

  const meters = useQuery({
    queryKey: ['estate', estateId, 'meters'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/meters', { params: { path: { estateId } } })),
  });

  const outages = useQuery({
    queryKey: ['estate', estateId, 'utility-outages'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/utility-outages', { params: { path: { estateId } } })),
  });

  const recordReading = useMutation({
    mutationFn: () => {
      if (!readingMeter) throw new Error('No meter selected');
      return unwrap(
        api.POST('/v1/estates/{estateId}/meter-readings', {
          params: { path: { estateId } },
          body: {
            readings: [
              {
                meterId: readingMeter.id,
                reading: Number(readingValue),
                readAt: new Date().toISOString(),
              },
            ],
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'meters'] });
      setReadingMeter(null);
      setReadingValue('');
    },
  });

  const createOutage = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/utility-outages', {
          params: { path: { estateId } },
          body: {
            type: outageType,
            title: outageTitle.trim(),
            details: outageDetails.trim() || undefined,
            startsAt: new Date().toISOString(),
            spaceIds: [],
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'utility-outages'] });
      setAnnouncing(false);
      setOutageTitle('');
      setOutageDetails('');
    },
  });

  const resolveOutage = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}/utility-outages/{id}', {
          params: { path: { estateId, id } },
          body: { status: 'resolved' },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'utility-outages'] });
    },
  });

  const meterCols: Column<Meter>[] = [
    {
      key: 'number',
      header: 'Meter number',
      render: (r) => <span className="sz-num">{r.meterNumber}</span>,
    },
    { key: 'type', header: 'Type', render: (r) => r.type },
    { key: 'provider', header: 'Provider', render: (r) => r.providerCode },
    {
      key: 'last',
      header: 'Last reading',
      render: (r) =>
        r.lastReading !== null ? (
          <span className="sz-num">
            {r.lastReading} ({r.lastReadAt ? formatDateTime(r.lastReadAt) : '-'})
          </span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <ActionButton
          variant="outline"
          size="sm"
          onClick={() => {
            recordReading.reset();
            setReadingValue('');
            setReadingMeter(r);
          }}
        >
          {t('utilities.recordReading')}
        </ActionButton>
      ),
    },
  ];

  const outageCols: Column<Outage>[] = [
    { key: 'title', header: 'Outage', render: (r) => r.title },
    { key: 'type', header: 'Utility', render: (r) => r.type },
    {
      key: 'starts',
      header: 'Started',
      render: (r) => <span className="sz-num">{formatDateTime(r.startsAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusPill tone={r.status === 'resolved' ? 'success' : 'warning'} label={r.status} />
      ),
    },
    ...(can('announcement.publish')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (r: Outage) =>
              r.status !== 'resolved' ? (
                <ActionButton
                  variant="outline"
                  size="sm"
                  busy={resolveOutage.isPending}
                  onClick={() => resolveOutage.mutate(r.id)}
                >
                  {t('utilities.resolveOutage')}
                </ActionButton>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('utilities.title')}
        description={t('utilities.description')}
        actions={
          can('announcement.publish') ? (
            <ActionButton
              icon="megaphone"
              onClick={() => {
                createOutage.reset();
                setAnnouncing(true);
              }}
            >
              {t('utilities.announceOutage')}
            </ActionButton>
          ) : null
        }
      />

      <Tabs<TabId>
        label={t('utilities.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'meters', label: t('utilities.tab.meters') },
          { key: 'outages', label: t('utilities.tab.outages') },
        ]}
      />

      {tab === 'meters' ? (
        <DataTable
          caption={t('utilities.tab.meters')}
          columns={meterCols}
          rows={meters.data ?? []}
          rowKey={(r) => r.id}
          loading={meters.isPending}
          error={meters.isError ? errorText(meters.error) : null}
          onRetry={() => void meters.refetch()}
          empty={{
            icon: 'activity',
            title: t('utilities.tab.meters'),
            body: t('utilities.emptyMeters'),
          }}
        />
      ) : (
        <DataTable
          caption={t('utilities.tab.outages')}
          columns={outageCols}
          rows={outages.data ?? []}
          rowKey={(r) => r.id}
          loading={outages.isPending}
          error={outages.isError ? errorText(outages.error) : null}
          onRetry={() => void outages.refetch()}
          empty={{
            icon: 'alert',
            title: t('utilities.tab.outages'),
            body: t('utilities.emptyOutages'),
          }}
        />
      )}

      {readingMeter ? (
        <Dialog
          title={`${t('utilities.recordReading')} (${readingMeter.meterNumber})`}
          onClose={() => setReadingMeter(null)}
          onSubmit={() => recordReading.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setReadingMeter(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" disabled={!readingValue} busy={recordReading.isPending}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={recordReading.isError ? errorText(recordReading.error) : null} />
          <div className="sz-form">
            <InputField
              label="Current meter reading"
              type="number"
              required
              value={readingValue}
              onChange={setReadingValue}
            />
          </div>
        </Dialog>
      ) : null}

      {announcing ? (
        <Dialog
          title={t('utilities.announceOutage')}
          onClose={() => setAnnouncing(false)}
          onSubmit={() => createOutage.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setAnnouncing(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!outageTitle.trim()}
                busy={createOutage.isPending}
              >
                {t('utilities.announceOutage')}
              </ActionButton>
            </>
          }
        >
          <FormError message={createOutage.isError ? errorText(createOutage.error) : null} />
          <div className="sz-form">
            <SelectField
              label="Utility"
              value={outageType}
              onChange={setOutageType}
              options={[
                { value: 'electricity', label: 'Electricity' },
                { value: 'water', label: 'Water' },
                { value: 'gas', label: 'Gas' },
                { value: 'internet', label: 'Internet' },
                { value: 'waste', label: 'Waste' },
              ]}
            />
            <InputField label="Title" required value={outageTitle} onChange={setOutageTitle} />
            <TextAreaField
              label="Details"
              rows={3}
              value={outageDetails}
              onChange={setOutageDetails}
            />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
