'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Channel = ApiRow<'/v1/estates/{estateId}/channels', 'get'>;

const CHANNEL_TONE: Record<string, Tone> = {
  active: 'success',
  pending_approval: 'warning',
  suspended: 'danger',
  archived: 'neutral',
};

export function ChannelsScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canModerate = can('community.moderate');

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'restricted' | 'invite_only'>('public');
  const [actionTarget, setActionTarget] = useState<{
    channel: Channel;
    kind: 'suspend' | 'archive';
  } | null>(null);

  const list = useQuery({
    queryKey: ['estate', estateId, 'channels'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/channels', {
          params: { path: { estateId }, query: { mine: 'false' } },
        }),
      ),
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/channels', {
          params: { path: { estateId } },
          body: { name: name.trim(), description: description.trim() || undefined, privacy },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] });
      setCreating(false);
      setName('');
      setDescription('');
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/channels/{id}/approve', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] });
    },
  });

  const suspendOrArchive = useMutation({
    mutationFn: ({
      id,
      kind,
      reason,
    }: {
      id: string;
      kind: 'suspend' | 'archive';
      reason: string;
    }) =>
      kind === 'suspend'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/channels/{id}/suspend', {
              params: { path: { estateId, id } },
              body: { reason },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/channels/{id}/archive', {
              params: { path: { estateId, id } },
              body: { reason },
            }),
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'channels'] });
      setActionTarget(null);
    },
  });

  const columns: Column<Channel>[] = [
    {
      key: 'name',
      header: t('mw.channels.channel'),
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name}</div>
          {r.description ? (
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {r.description}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: 'privacy', header: t('mw.channels.privacy'), render: (r) => r.privacy },
    {
      key: 'members',
      header: t('mw.channels.members'),
      align: 'right',
      render: (r) => <span className="sz-num">{r.memberCount}</span>,
    },
    {
      key: 'status',
      header: t('mw.channels.status'),
      render: (r) => (
        <StatusPill
          tone={CHANNEL_TONE[r.status] ?? 'neutral'}
          label={r.status.replace(/_/g, ' ')}
        />
      ),
    },
    ...(canModerate
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (r: Channel) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {r.status === 'pending_approval' ? (
                  <ActionButton
                    size="sm"
                    busy={approve.isPending}
                    onClick={() => approve.mutate(r.id)}
                  >
                    {t('channels.approve')}
                  </ActionButton>
                ) : null}
                {r.status === 'active' ? (
                  <>
                    <ActionButton
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        suspendOrArchive.reset();
                        setActionTarget({ channel: r, kind: 'suspend' });
                      }}
                    >
                      {t('channels.suspend')}
                    </ActionButton>
                    <ActionButton
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        suspendOrArchive.reset();
                        setActionTarget({ channel: r, kind: 'archive' });
                      }}
                    >
                      {t('channels.archive')}
                    </ActionButton>
                  </>
                ) : null}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('channels.title')}
        description={t('channels.description')}
        actions={
          can('community.channel.create') ? (
            <ActionButton
              icon="plus"
              onClick={() => {
                create.reset();
                setCreating(true);
              }}
            >
              {t('channels.create')}
            </ActionButton>
          ) : null
        }
      />

      <DataTable
        caption={t('channels.title')}
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{ icon: 'messageSquare', title: t('channels.title'), body: t('channels.empty') }}
      />

      {creating ? (
        <Dialog
          title={t('channels.create')}
          onClose={() => setCreating(false)}
          onSubmit={() => create.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" disabled={!name.trim()} busy={create.isPending}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={create.isError ? errorText(create.error) : null} />
          <div className="sz-form">
            <InputField label={t('mw.channels.name')} required value={name} onChange={setName} />
            <TextAreaField
              label={t('mw.channels.description')}
              rows={3}
              value={description}
              onChange={setDescription}
            />
            <SelectField
              label={t('mw.channels.privacy')}
              value={privacy}
              onChange={setPrivacy}
              options={[
                { value: 'public', label: t('mw.channels.public') },
                { value: 'restricted', label: t('mw.channels.restrictedApprovalRequired') },
                { value: 'invite_only', label: t('mw.channels.inviteOnly') },
              ]}
            />
          </div>
        </Dialog>
      ) : null}

      {actionTarget ? (
        <ConfirmDialog
          title={actionTarget.kind === 'suspend' ? t('channels.suspend') : t('channels.archive')}
          body={
            actionTarget.kind === 'suspend'
              ? t('mw.channels.suspendThisChannelMembersWill')
              : t('mw.channels.archiveThisChannelItWill')
          }
          confirmLabel={
            actionTarget.kind === 'suspend' ? t('channels.suspend') : t('channels.archive')
          }
          destructive={actionTarget.kind === 'suspend'}
          reason={{ label: t('mw.channels.reason'), required: true }}
          busy={suspendOrArchive.isPending}
          error={suspendOrArchive.isError ? errorText(suspendOrArchive.error) : null}
          onClose={() => setActionTarget(null)}
          onConfirm={(reason) =>
            suspendOrArchive.mutate({
              id: actionTarget.channel.id,
              kind: actionTarget.kind,
              reason: reason ?? '',
            })
          }
        />
      ) : null}
    </>
  );
}
