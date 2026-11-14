'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  type Tone,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type Space = ApiRow<'/v1/estates/{estateId}/spaces', 'get'>;
type SpaceType = Space['type'];
type UnitType = NonNullable<Space['unitType']>;
type UnitStatus = NonNullable<Space['status']>;

const SPACE_TYPES: SpaceType[] = [
  'phase',
  'zone',
  'street',
  'block',
  'building',
  'floor',
  'unit',
  'common_area',
];
const UNIT_TYPES: UnitType[] = ['house', 'flat', 'shop', 'office', 'other'];
const UNIT_STATUSES: UnitStatus[] = ['vacant', 'occupied', 'under_construction', 'reserved'];
const STATUS_TONE: Record<UnitStatus, Tone> = {
  vacant: 'neutral',
  occupied: 'success',
  under_construction: 'warning',
  reserved: 'info',
};

const typeLabel = (type: SpaceType) => t(`space.type.${type}` as MessageKey);
const unitTypeLabel = (type: UnitType) => t(`space.unitType.${type}` as MessageKey);
const statusLabel = (status: UnitStatus) => t(`space.status.${status}` as MessageKey);

/** Child type suggested when adding inside a parent, so the common path is one click. */
function suggestedChild(parent: Space | undefined): SpaceType {
  if (!parent) return 'street';
  const next: Partial<Record<SpaceType, SpaceType>> = {
    phase: 'zone',
    zone: 'street',
    street: 'unit',
    block: 'building',
    building: 'floor',
    floor: 'unit',
  };
  return next[parent.type] ?? 'unit';
}

interface SpaceForm {
  type: SpaceType;
  code: string;
  name: string;
  unitType: UnitType;
  bedrooms: string;
  status: UnitStatus;
}

function SpaceDialog({
  parent,
  editing,
  onClose,
}: {
  parent: Space | undefined;
  editing: Space | null;
  onClose: () => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SpaceForm>({
    type: editing?.type ?? suggestedChild(parent),
    code: editing?.code ?? '',
    name: editing?.name ?? '',
    unitType: editing?.unitType ?? 'house',
    bedrooms:
      editing?.bedrooms !== null && editing?.bedrooms !== undefined ? String(editing.bedrooms) : '',
    status: editing?.status ?? 'vacant',
  });
  const [codeError, setCodeError] = useState<string | null>(null);
  const set = <K extends keyof SpaceForm>(key: K, value: SpaceForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const isUnit = form.type === 'unit';

  const save = useMutation({
    mutationFn: () => {
      const bedrooms = form.bedrooms.trim() === '' ? undefined : Number(form.bedrooms);
      const unitFields = isUnit ? { unitType: form.unitType, bedrooms, status: form.status } : {};
      if (editing)
        return unwrap(
          api.PATCH('/v1/estates/{estateId}/spaces/{id}', {
            params: { path: { estateId, id: editing.id } },
            body: { code: form.code.trim(), name: form.name.trim() || undefined, ...unitFields },
          }),
        );
      return unwrap(
        api.POST('/v1/estates/{estateId}/spaces', {
          params: { path: { estateId } },
          body: {
            parentId: parent?.id ?? null,
            type: form.type,
            code: form.code.trim(),
            name: form.name.trim() || undefined,
            ...unitFields,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'spaces'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'setup-progress'] });
      onClose();
    },
  });

  return (
    <Dialog
      title={editing ? t('space.edit.title', { code: editing.code }) : t('space.add.title')}
      onClose={onClose}
      onSubmit={() => {
        if (!form.code.trim()) return setCodeError(t('space.form.codeRequired'));
        setCodeError(null);
        save.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {editing ? t('common.save') : t('space.add.submit')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        {parent && !editing ? (
          <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
            {t('space.add.inside', { parent: `${parent.code} ${parent.name}`.trim() })}
          </p>
        ) : null}
        <div className="sz-form-2">
          {editing ? null : (
            <SelectField
              label={t('space.form.type')}
              value={form.type}
              onChange={(value) => set('type', value)}
              options={SPACE_TYPES.map((type) => ({ value: type, label: typeLabel(type) }))}
            />
          )}
          <InputField
            label={t('space.form.code')}
            value={form.code}
            onChange={(value) => set('code', value)}
            helper={t('space.form.codeHelp')}
            error={codeError}
            maxLength={40}
            autoFocus
          />
        </div>
        <InputField
          label={t('space.form.name')}
          value={form.name}
          onChange={(value) => set('name', value)}
          maxLength={120}
        />
        {isUnit ? (
          <div className="sz-form-2">
            <SelectField
              label={t('space.form.unitType')}
              value={form.unitType}
              onChange={(value) => set('unitType', value)}
              options={UNIT_TYPES.map((type) => ({ value: type, label: unitTypeLabel(type) }))}
            />
            <InputField
              label={t('space.form.bedrooms')}
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={form.bedrooms}
              onChange={(value) => set('bedrooms', value)}
            />
            <SelectField
              label={t('space.form.status')}
              value={form.status}
              onChange={(value) => set('status', value)}
              options={UNIT_STATUSES.map((status) => ({
                value: status,
                label: statusLabel(status),
              }))}
            />
          </div>
        ) : null}
        <FormError message={save.isError ? errorText(save.error) : null} />
      </div>
    </Dialog>
  );
}

export function SpacesScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canManage = can('space.manage');
  const [trail, setTrail] = useState<Space[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<{ editing: Space | null } | null>(null);
  const [archiving, setArchiving] = useState<Space | null>(null);
  const parent = trail[trail.length - 1];

  const list = usePaged<Space>(
    ['estate', estateId, 'spaces', parent?.id ?? 'root', showArchived],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/spaces', {
          params: {
            path: { estateId },
            query: {
              parentId: parent?.id,
              includeArchived: showArchived ? 'true' : undefined,
              limit: 50,
              cursor,
            },
          },
        }),
      ),
  );

  const archive = useMutation({
    mutationFn: (space: Space) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/spaces/{id}/archive', {
          params: { path: { estateId, id: space.id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'spaces'] });
      setArchiving(null);
    },
  });

  const columns: Column<Space>[] = [
    {
      key: 'code',
      header: t('space.col.code'),
      render: (space) => <strong>{space.code}</strong>,
    },
    {
      key: 'name',
      header: t('space.col.name'),
      render: (space) => space.name || <span className="sz-muted">-</span>,
    },
    { key: 'type', header: t('space.col.type'), render: (space) => typeLabel(space.type) },
    {
      key: 'detail',
      header: t('space.col.detail'),
      render: (space) =>
        space.type === 'unit' ? (
          <span>
            {space.unitType ? unitTypeLabel(space.unitType) : ''}
            {space.bedrooms !== null
              ? ` · ${t('space.bedroomsShort', { count: space.bedrooms })}`
              : ''}
          </span>
        ) : (
          <span className="sz-muted">{t('space.openToSee')}</span>
        ),
    },
    {
      key: 'status',
      header: t('space.col.status'),
      render: (space) =>
        space.archivedAt ? (
          <StatusPill tone="neutral" label={t('space.archived')} />
        ) : space.status ? (
          <StatusPill tone={STATUS_TONE[space.status]} label={statusLabel(space.status)} />
        ) : null,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('common.actions'),
            align: 'right' as const,
            render: (space: Space) =>
              space.archivedAt ? null : (
                <span
                  style={{ display: 'inline-flex', gap: 4 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ActionButton
                    variant="text"
                    size="sm"
                    onClick={() => setDialog({ editing: space })}
                  >
                    {t('common.edit')}
                  </ActionButton>
                  <ActionButton variant="text" size="sm" onClick={() => setArchiving(space)}>
                    {t('space.archive')}
                  </ActionButton>
                </span>
              ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('space.title')}
        description={t('space.description')}
        breadcrumbs={
          trail.length > 0 ? (
            <>
              <button type="button" onClick={() => setTrail([])}>
                {t('space.root')}
              </button>
              {trail.map((space, index) => (
                <span key={space.id} style={{ display: 'inline-flex', gap: 4 }}>
                  <span aria-hidden="true">/</span>
                  {index === trail.length - 1 ? (
                    <span>{space.code}</span>
                  ) : (
                    <button type="button" onClick={() => setTrail(trail.slice(0, index + 1))}>
                      {space.code}
                    </button>
                  )}
                </span>
              ))}
            </>
          ) : null
        }
        actions={
          canManage ? (
            <ActionButton icon="plus" onClick={() => setDialog({ editing: null })}>
              {parent ? t('space.addInside', { code: parent.code }) : t('space.add.title')}
            </ActionButton>
          ) : null
        }
      />
      <Toolbar>
        <CheckboxField
          label={t('space.showArchived')}
          checked={showArchived}
          onChange={setShowArchived}
        />
      </Toolbar>
      <DataTable
        caption={t('space.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(space) => space.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        onRowClick={(space) => {
          if (space.type !== 'unit') setTrail([...trail, space]);
          else if (canManage && !space.archivedAt) setDialog({ editing: space });
        }}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'building',
          title: parent ? t('space.empty.childTitle') : t('space.empty.title'),
          body: canManage ? t('space.empty.body') : undefined,
        }}
      />
      {dialog ? (
        <SpaceDialog parent={parent} editing={dialog.editing} onClose={() => setDialog(null)} />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          title={t('space.archiveConfirm.title', { code: archiving.code })}
          body={t('space.archiveConfirm.body')}
          confirmLabel={t('space.archive')}
          cancelLabel={t('space.archiveConfirm.keep')}
          destructive
          busy={archive.isPending}
          error={archive.isError ? errorText(archive.error) : null}
          onConfirm={() => archive.mutate(archiving)}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}
