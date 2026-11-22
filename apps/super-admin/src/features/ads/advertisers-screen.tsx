'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import type { AdCategory } from '@safezone/schemas';
import {
  ActionButton,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';
import { categoryOptions } from './ads';

type Advertiser = ApiRow<'/v1/platform/advertisers', 'get'>;
type AdvertiserType = 'individual' | 'organisation';

export function AdvertiserDialog({
  initial,
  onClose,
  onCreated,
}: {
  initial?: {
    type: AdvertiserType;
    name: string;
    category: AdCategory;
    ownerPhone: string;
    enquiryId?: string;
  };
  onClose: () => void;
  onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<AdvertiserType>(initial?.type ?? 'organisation');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<AdCategory>(initial?.category ?? 'other');
  const [ownerPhone, setOwnerPhone] = useState(initial?.ownerPhone ?? '');
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/advertisers', {
          body: {
            type,
            name: name.trim(),
            category,
            ownerPhone: ownerPhone.trim(),
            ...(initial?.enquiryId ? { enquiryId: initial.enquiryId } : {}),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'advertisers'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'ad-enquiries'] });
      onCreated?.();
      onClose();
    },
  });
  return (
    <Dialog
      title={t('admin.ads.advertisers.add')}
      onClose={onClose}
      onSubmit={() => {
        if (name.trim().length >= 2 && ownerPhone.trim()) create.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('admin.ads.cancel')}
          </ActionButton>
          <ActionButton
            type="submit"
            busy={create.isPending}
            disabled={name.trim().length < 2 || !ownerPhone.trim()}
          >
            {t('admin.ads.advertisers.add')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <SelectField
          label={t('admin.ads.advertisers.type')}
          value={type}
          onChange={setType}
          options={[
            { value: 'organisation', label: t('admin.ads.advertisers.type.organisation') },
            { value: 'individual', label: t('admin.ads.advertisers.type.individual') },
          ]}
        />
        <InputField
          label={t('admin.ads.advertisers.name')}
          value={name}
          onChange={setName}
          maxLength={160}
          autoFocus
        />
        <SelectField
          label={t('admin.ads.category')}
          value={category}
          onChange={setCategory}
          options={categoryOptions}
        />
        <InputField
          label={t('admin.ads.advertisers.ownerPhone')}
          helper={t('admin.ads.advertisers.ownerPhoneHelper')}
          type="tel"
          value={ownerPhone}
          onChange={setOwnerPhone}
          maxLength={20}
        />
        <FormError message={create.isError ? errorText(create.error) : null} />
      </div>
    </Dialog>
  );
}

/** Advertisers (advertising.md §2.2): create, verify, suspend. */
export function AdvertisersScreen() {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [suspending, setSuspending] = useState<Advertiser | null>(null);
  const query = useQuery({
    queryKey: ['platform', 'advertisers', cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/advertisers', {
          params: { query: { limit: 25, ...(cursor ? { cursor } : {}) } },
        }),
      ),
  });
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { verificationStatus?: 'verified'; status?: 'active' | 'suspended'; reason?: string };
    }) => unwrap(api.PATCH('/v1/platform/advertisers/{id}', { params: { path: { id } }, body })),
    onSuccess: () => {
      setSuspending(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'advertisers'] });
    },
  });
  return (
    <>
      <PageHeader
        title={t('admin.ads.advertisers.title')}
        description={t('admin.ads.advertisers.description')}
        actions={
          can('ad.enquiry.manage') ? (
            <ActionButton icon="plus" onClick={() => setAdding(true)}>
              {t('admin.ads.advertisers.add')}
            </ActionButton>
          ) : null
        }
      />
      <FormError message={update.isError && !suspending ? errorText(update.error) : null} />
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.ads.advertisers.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'megaphone', title: t('admin.ads.advertisers.empty') }}
          columns={[
            {
              key: 'name',
              header: t('admin.ads.advertisers.name'),
              render: (row) => (
                <div>
                  <strong>{row.name}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {t(`admin.ads.advertisers.type.${row.type}`)} · {humanizeStatus(row.category)}
                  </div>
                </div>
              ),
            },
            {
              key: 'verification',
              header: t('admin.ads.advertisers.verification'),
              render: (row) => (
                <StatusPill
                  tone={statusTone(row.verificationStatus)}
                  label={humanizeStatus(row.verificationStatus)}
                />
              ),
            },
            {
              key: 'status',
              header: t('admin.ads.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'since',
              header: t('admin.ads.received'),
              render: (row) => formatWat(row.createdAt),
            },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {row.verificationStatus !== 'verified' ? (
                    <ActionButton
                      size="sm"
                      variant="outline"
                      busy={update.isPending && update.variables?.id === row.id}
                      onClick={() =>
                        update.mutate({ id: row.id, body: { verificationStatus: 'verified' } })
                      }
                    >
                      {t('admin.ads.advertisers.verify')}
                    </ActionButton>
                  ) : null}
                  {row.status === 'active' ? (
                    <ActionButton size="sm" variant="text" onClick={() => setSuspending(row)}>
                      {t('admin.ads.advertisers.suspend')}
                    </ActionButton>
                  ) : (
                    <ActionButton
                      size="sm"
                      variant="outline"
                      onClick={() => update.mutate({ id: row.id, body: { status: 'active' } })}
                    >
                      {t('admin.ads.advertisers.reactivate')}
                    </ActionButton>
                  )}
                  <Link href={`/ads/campaigns?advertiserId=${row.id}`}>
                    <ActionButton size="sm" variant="text">
                      {t('admin.ads.advertisers.campaigns')}
                    </ActionButton>
                  </Link>
                </div>
              ),
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
      {adding ? <AdvertiserDialog onClose={() => setAdding(false)} /> : null}
      {suspending ? (
        <ConfirmDialog
          title={t('admin.ads.advertisers.suspendTitle', { name: suspending.name })}
          body={t('admin.ads.advertisers.suspendBody')}
          confirmLabel={t('admin.ads.advertisers.suspend')}
          destructive
          reason={{ label: t('admin.ads.reason'), required: true }}
          busy={update.isPending}
          error={update.isError ? errorText(update.error) : null}
          onConfirm={(reason) =>
            update.mutate({ id: suspending.id, body: { status: 'suspended', reason } })
          }
          onClose={() => setSuspending(null)}
        />
      ) : null}
    </>
  );
}
