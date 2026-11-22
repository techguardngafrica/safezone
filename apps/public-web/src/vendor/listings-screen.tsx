'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  type Column,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
} from '@safezone/web-ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { nairaToKobo } from './money';
import { useVendor } from './vendor-context';

type Listing = ApiRow<'/v1/vendors/{vendorId}/listings', 'get'>;
type PriceType = Listing['priceType'];
type Status = Listing['status'];
const PRICE_TYPES: PriceType[] = ['fixed', 'from', 'quote'];
const STATUS_TONE: Record<Status, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  draft: 'neutral',
  paused: 'warning',
  archived: 'neutral',
};

export function priceText(listing: { priceType: PriceType; priceKobo: number | null }): string {
  if (listing.priceType === 'quote' || listing.priceKobo === null)
    return t('vendor.listings.onQuote');
  if (listing.priceType === 'from')
    return t('vendor.listings.from', { price: formatKobo(listing.priceKobo) });
  return formatKobo(listing.priceKobo);
}

function ListingDialog({ editing, onClose }: { editing: Listing | null; onClose: () => void }) {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => unwrap(api.GET('/v1/marketplace/categories')),
  });
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [priceType, setPriceType] = useState<PriceType>(editing?.priceType ?? 'fixed');
  const [price, setPrice] = useState(editing?.priceKobo ? String(editing.priceKobo / 100) : '');
  const [duration, setDuration] = useState(
    editing?.durationMinutes ? String(editing.durationMinutes) : '',
  );
  const [publish, setPublish] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const priceKobo = priceType === 'quote' ? undefined : (nairaToKobo(price) ?? undefined);
      const durationMinutes = duration ? Number(duration) : undefined;
      if (editing)
        return unwrap(
          api.PATCH('/v1/vendors/{vendorId}/listings/{id}', {
            params: { path: { vendorId, id: editing.id } },
            body: {
              categoryId,
              title: title.trim(),
              description: description.trim(),
              priceType,
              priceKobo: priceType === 'quote' ? null : priceKobo,
              durationMinutes: durationMinutes ?? null,
            },
          }),
        );
      return unwrap(
        api.POST('/v1/vendors/{vendorId}/listings', {
          params: { path: { vendorId } },
          body: {
            categoryId,
            title: title.trim(),
            description: description.trim(),
            priceType,
            priceKobo,
            durationMinutes,
            photoFileIds: [],
            status: publish ? 'active' : 'draft',
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId, 'listings'] });
      onClose();
    },
  });

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!categoryId) next.category = t('vendor.listings.categoryRequired');
    if (title.trim().length < 3) next.title = t('vendor.listings.titleRequired');
    if (description.trim().length < 10) next.description = t('vendor.listings.descriptionRequired');
    if (priceType !== 'quote' && nairaToKobo(price) === null)
      next.price = t('vendor.listings.priceInvalid');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  return (
    <Dialog
      title={editing ? t('vendor.listings.edit') : t('vendor.listings.add')}
      onClose={onClose}
      onSubmit={() => {
        if (validate()) save.mutate();
      }}
      wide
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {editing ? t('common.save') : t('vendor.listings.add')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <SelectField
          label={t('vendor.listings.form.category')}
          value={categoryId}
          onChange={setCategoryId}
          error={errors.category}
          options={[
            { value: '', label: t('vendor.listings.form.chooseCategory') },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <InputField
          label={t('vendor.listings.form.title')}
          value={title}
          onChange={setTitle}
          error={errors.title}
          maxLength={120}
          autoFocus
        />
        <TextAreaField
          label={t('vendor.listings.form.description')}
          value={description}
          onChange={setDescription}
          error={errors.description}
          rows={4}
          maxLength={4000}
        />
        <SelectField
          label={t('vendor.listings.form.priceType')}
          value={priceType}
          onChange={setPriceType}
          options={PRICE_TYPES.map((value) => ({
            value,
            label: t(`vendor.listings.priceType.${value}` as MessageKey),
          }))}
        />
        {priceType !== 'quote' ? (
          <InputField
            label={t('vendor.listings.form.price')}
            value={price}
            onChange={setPrice}
            error={errors.price}
            inputMode="decimal"
            maxLength={14}
          />
        ) : null}
        <InputField
          label={t('vendor.listings.form.duration')}
          type="number"
          value={duration}
          onChange={setDuration}
          min={15}
          max={10080}
        />
        {editing ? null : (
          <CheckboxField
            label={t('vendor.listings.form.publish')}
            checked={publish}
            onChange={setPublish}
          />
        )}
        <FormError message={save.isError ? errorText(save.error) : null} />
      </div>
    </Dialog>
  );
}

/** Listings (public-web.md §8). */
export function ListingsScreen() {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ editing: Listing | null } | null>(null);
  const listings = useInfiniteQuery({
    queryKey: ['vendor', vendorId, 'listings', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/vendors/{vendorId}/listings', {
          params: {
            path: { vendorId },
            query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const setStatus = useMutation({
    mutationFn: ({ listing, status }: { listing: Listing; status: Status }) =>
      unwrap(
        api.PATCH('/v1/vendors/{vendorId}/listings/{id}', {
          params: { path: { vendorId, id: listing.id } },
          body: { status },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId, 'listings'] }),
  });

  const columns: Column<Listing>[] = [
    {
      key: 'title',
      header: t('vendor.listings.col.title'),
      render: (l) => <strong>{l.title}</strong>,
    },
    {
      key: 'price',
      header: t('vendor.listings.col.price'),
      render: (l) => priceText(l),
      align: 'right',
    },
    {
      key: 'status',
      header: t('vendor.listings.col.status'),
      render: (l) => (
        <StatusPill
          tone={STATUS_TONE[l.status]}
          label={t(`vendor.listings.status.${l.status}` as MessageKey)}
        />
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (l) => {
        const busy = setStatus.isPending && setStatus.variables?.listing.id === l.id;
        return (
          <span
            style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}
          >
            <ActionButton variant="text" size="sm" onClick={() => setDialog({ editing: l })}>
              {t('common.edit')}
            </ActionButton>
            {l.status === 'active' ? (
              <ActionButton
                variant="text"
                size="sm"
                busy={busy}
                onClick={() => setStatus.mutate({ listing: l, status: 'paused' })}
              >
                {t('vendor.listings.pause')}
              </ActionButton>
            ) : (
              <ActionButton
                variant="text"
                size="sm"
                busy={busy}
                onClick={() => setStatus.mutate({ listing: l, status: 'active' })}
              >
                {t('vendor.listings.activate')}
              </ActionButton>
            )}
            <ActionButton
              variant="text"
              size="sm"
              busy={busy}
              onClick={() => setStatus.mutate({ listing: l, status: 'archived' })}
            >
              {t('vendor.listings.archive')}
            </ActionButton>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t('vendor.listings.title')}
        description={t('vendor.listings.description')}
        actions={
          <ActionButton icon="plus" onClick={() => setDialog({ editing: null })}>
            {t('vendor.listings.add')}
          </ActionButton>
        }
      />
      <FormError message={setStatus.isError ? errorText(setStatus.error) : null} />
      <DataTable
        caption={t('vendor.listings.title')}
        columns={columns}
        rows={listings.data?.pages.flatMap((p) => p.items)}
        rowKey={(l) => l.id}
        loading={listings.isPending}
        error={listings.isError ? errorText(listings.error) : null}
        onRetry={() => void listings.refetch()}
        empty={{
          icon: 'list',
          title: t('vendor.listings.empty.title'),
          body: t('vendor.listings.empty.body'),
        }}
        hasMore={listings.hasNextPage}
        loadingMore={listings.isFetchingNextPage}
        onLoadMore={() => void listings.fetchNextPage()}
      />
      {dialog ? <ListingDialog editing={dialog.editing} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
