'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
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
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Gate = ApiRow<'/v1/estates/{estateId}/gates', 'get'>;
type GateType = Gate['type'];
const GATE_TYPES: GateType[] = ['vehicle', 'pedestrian', 'both'];

function GateDialog({ editing, onClose }: { editing: Gate | null; onClose: () => void }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<GateType>(editing?.type ?? 'both');
  const [nameError, setNameError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.PATCH('/v1/estates/{estateId}/gates/{id}', {
              params: { path: { estateId, id: editing.id } },
              body: { name: name.trim(), type },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/gates', {
              params: { path: { estateId } },
              body: { name: name.trim(), type },
            }),
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'gates'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'setup-progress'] });
      onClose();
    },
  });
  return (
    <Dialog
      title={editing ? t('gate.edit.title') : t('gate.add.title')}
      onClose={onClose}
      onSubmit={() => {
        if (!name.trim()) return setNameError(t('gate.form.nameRequired'));
        setNameError(null);
        save.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {editing ? t('common.save') : t('gate.add.submit')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <InputField
          label={t('gate.form.name')}
          value={name}
          onChange={setName}
          placeholder={t('gate.form.namePlaceholder')}
          error={nameError}
          maxLength={80}
          autoFocus
        />
        <SelectField
          label={t('gate.form.type')}
          value={type}
          onChange={setType}
          options={GATE_TYPES.map((value) => ({
            value,
            label: t(`gate.type.${value}` as MessageKey),
          }))}
        />
        <FormError message={save.isError ? errorText(save.error) : null} />
      </div>
    </Dialog>
  );
}

export function GatesScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ editing: Gate | null } | null>(null);
  const gates = useQuery({
    queryKey: ['estate', estateId, 'gates'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gates', { params: { path: { estateId } } })),
  });
  const toggle = useMutation({
    mutationFn: (gate: Gate) =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}/gates/{id}', {
          params: { path: { estateId, id: gate.id } },
          body: { status: gate.status === 'active' ? 'inactive' : 'active' },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'gates'] }),
  });

  const columns: Column<Gate>[] = [
    { key: 'name', header: t('gate.col.name'), render: (gate) => <strong>{gate.name}</strong> },
    {
      key: 'type',
      header: t('gate.col.type'),
      render: (gate) => t(`gate.type.${gate.type}` as MessageKey),
    },
    {
      key: 'status',
      header: t('gate.col.status'),
      render: (gate) => (
        <StatusPill
          tone={gate.status === 'active' ? 'success' : 'neutral'}
          label={t(`gate.status.${gate.status}` as MessageKey)}
        />
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (gate) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <ActionButton variant="text" size="sm" onClick={() => setDialog({ editing: gate })}>
            {t('common.edit')}
          </ActionButton>
          <ActionButton
            variant="text"
            size="sm"
            busy={toggle.isPending && toggle.variables?.id === gate.id}
            onClick={() => toggle.mutate(gate)}
          >
            {gate.status === 'active' ? t('gate.deactivate') : t('gate.activate')}
          </ActionButton>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('gate.title')}
        description={t('gate.description')}
        actions={
          <ActionButton icon="plus" onClick={() => setDialog({ editing: null })}>
            {t('gate.add.title')}
          </ActionButton>
        }
      />
      {toggle.isError ? <FormError message={errorText(toggle.error)} /> : null}
      <DataTable
        caption={t('gate.title')}
        columns={columns}
        rows={gates.data}
        rowKey={(gate) => gate.id}
        loading={gates.isPending}
        error={gates.isError ? errorText(gates.error) : null}
        onRetry={() => void gates.refetch()}
        empty={{ icon: 'door', title: t('gate.empty.title'), body: t('gate.empty.body') }}
      />
      {dialog ? <GateDialog editing={dialog.editing} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
