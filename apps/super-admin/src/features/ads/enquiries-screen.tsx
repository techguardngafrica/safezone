'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  DataTable,
  DetailList,
  Drawer,
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
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';
import { AdvertiserDialog } from './advertisers-screen';

type Enquiry = ApiRow<'/v1/platform/ad-enquiries', 'get'>;
type Status = Enquiry['status'];
const STATUSES: Status[] = [
  'submitted',
  'under_review',
  'awaiting_information',
  'proposal_sent',
  'negotiation',
  'approved',
  'rejected',
  'converted_to_campaign',
];

function EnquiryDrawer({ enquiry, onClose }: { enquiry: Enquiry; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const [status, setStatus] = useState<Status>(enquiry.status);
  const [notes, setNotes] = useState(enquiry.notes ?? '');
  const [creating, setCreating] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/v1/platform/ad-enquiries/{id}', {
          params: { path: { id: enquiry.id } },
          body: { status, notes },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'ad-enquiries'] }),
  });
  return (
    <Drawer title={enquiry.orgName ?? enquiry.contactName} onClose={onClose}>
      <div style={{ display: 'grid', gap: 16 }}>
        <DetailList
          items={[
            {
              label: t('admin.ads.contact'),
              value: `${enquiry.contactName}, ${enquiry.phone}, ${enquiry.email}`,
            },
            { label: t('admin.ads.enquiries.from'), value: humanizeStatus(enquiry.source) },
            { label: t('admin.ads.category'), value: humanizeStatus(enquiry.category) },
            { label: t('admin.ads.budget'), value: humanizeStatus(enquiry.budgetRange) },
            ...(enquiry.durationWeeks
              ? [
                  {
                    label: t('admin.ads.enquiries.duration'),
                    value: t('admin.ads.enquiries.weeks', { count: enquiry.durationWeeks }),
                  },
                ]
              : []),
            { label: t('admin.ads.enquiries.objectives'), value: enquiry.objectives },
            {
              label: t('admin.ads.enquiries.details'),
              value: <span style={{ whiteSpace: 'pre-wrap' }}>{enquiry.description}</span>,
            },
            ...(enquiry.audience
              ? [{ label: t('admin.ads.enquiries.audience'), value: enquiry.audience }]
              : []),
            ...(enquiry.placements.length > 0
              ? [
                  {
                    label: t('admin.ads.enquiries.placements'),
                    value: enquiry.placements.join(', '),
                  },
                ]
              : []),
            { label: t('admin.ads.received'), value: formatWat(enquiry.createdAt) },
          ]}
        />
        <form
          className="sz-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <SelectField
            label={t('admin.ads.status')}
            value={status}
            onChange={setStatus}
            options={STATUSES.map((value) => ({ value, label: humanizeStatus(value) }))}
          />
          <TextAreaField
            label={t('admin.ads.notes')}
            value={notes}
            onChange={setNotes}
            rows={4}
            maxLength={4000}
          />
          {save.isSuccess ? <Banner tone="success">{t('admin.ads.enquiries.saved')}</Banner> : null}
          <FormError message={save.isError ? errorText(save.error) : null} />
          <div>
            <ActionButton type="submit" busy={save.isPending}>
              {t('admin.ads.save')}
            </ActionButton>
          </div>
        </form>
        {enquiry.advertiserId ? (
          <Link href={`/ads/campaigns?advertiserId=${enquiry.advertiserId}`}>
            <ActionButton variant="outline">{t('admin.ads.enquiries.openAdvertiser')}</ActionButton>
          </Link>
        ) : can('ad.enquiry.manage') ? (
          <ActionButton variant="outline" onClick={() => setCreating(true)}>
            {t('admin.ads.enquiries.createAdvertiser')}
          </ActionButton>
        ) : null}
      </div>
      {creating ? (
        <AdvertiserDialog
          initial={{
            type: enquiry.advertiserType,
            name: enquiry.orgName ?? enquiry.contactName,
            category: enquiry.category,
            ownerPhone: enquiry.phone,
            enquiryId: enquiry.id,
          }}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onClose();
          }}
        />
      ) : null}
    </Drawer>
  );
}

/** Advertising enquiries (advertising.md §2.1). */
export function EnquiriesScreen() {
  const [status, setStatus] = useState<Status | ''>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<Enquiry | null>(null);
  const query = useQuery({
    queryKey: ['platform', 'ad-enquiries', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/ad-enquiries', {
          params: {
            query: { limit: 25, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) },
          },
        }),
      ),
  });
  return (
    <>
      <PageHeader
        title={t('admin.ads.enquiries.title')}
        description={t('admin.ads.enquiries.description')}
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
            { value: '', label: t('admin.ads.allStatuses') },
            ...STATUSES.map((value) => ({ value, label: humanizeStatus(value) })),
          ]}
        />
      </Toolbar>
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.ads.enquiries.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={setOpen}
          selectedKey={open?.id ?? null}
          empty={{ icon: 'inbox', title: t('admin.ads.enquiries.empty') }}
          columns={[
            {
              key: 'who',
              header: t('admin.ads.contact'),
              render: (row) => (
                <div>
                  <strong>{row.orgName ?? row.contactName}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.objectives}
                  </div>
                </div>
              ),
            },
            {
              key: 'category',
              header: t('admin.ads.category'),
              render: (row) => humanizeStatus(row.category),
            },
            {
              key: 'budget',
              header: t('admin.ads.budget'),
              render: (row) => humanizeStatus(row.budgetRange),
            },
            {
              key: 'status',
              header: t('admin.ads.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'received',
              header: t('admin.ads.received'),
              render: (row) => formatWat(row.createdAt),
            },
          ]}
        />
      )}
      {query.data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <ActionButton
            variant="outline"
            onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
          >
            {t('admin.ads.loadMore')}
          </ActionButton>
        </div>
      ) : null}
      {open ? <EnquiryDrawer enquiry={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
