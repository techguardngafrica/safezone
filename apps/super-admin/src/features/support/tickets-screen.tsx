'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  DataTable,
  DetailList,
  Dialog,
  Drawer,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  Skeleton,
  StatusPill,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

type TicketStatus = '' | 'new' | 'open' | 'pending_customer' | 'resolved' | 'closed';
type TicketPriority = '' | 'critical' | 'high' | 'normal' | 'low';

export function TicketsScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TicketStatus>('');
  const [priority, setPriority] = useState<TicketPriority>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<
    'gate_sos' | 'onboarding' | 'billing' | 'technical' | 'account' | 'other'
  >('technical');
  const [newPriority, setNewPriority] = useState<'critical' | 'high' | 'normal' | 'low'>('normal');
  const [requesterName, setRequesterName] = useState('');
  const [requesterContact, setRequesterContact] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyInternal, setReplyInternal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'tickets', status, priority, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/support-tickets', {
          params: {
            query: {
              ...(status ? { status } : {}),
              ...(priority ? { priority } : {}),
              limit: 25,
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const detail = useQuery({
    queryKey: ['platform', 'ticket', selectedId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/support-tickets/{id}', { params: { path: { id: selectedId! } } }),
      ),
    enabled: Boolean(selectedId),
  });

  const createTicket = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/support-tickets', {
          body: {
            subject: subject.trim(),
            description: description.trim(),
            category,
            priority: newPriority,
            channel: 'internal',
            ...(requesterName.trim() ? { requesterName: requesterName.trim() } : {}),
            ...(requesterContact.trim() ? { requesterContact: requesterContact.trim() } : {}),
          },
        }),
      ),
    onSuccess: (created) => {
      setCreateOpen(false);
      setSubject('');
      setDescription('');
      setRequesterName('');
      setRequesterContact('');
      setActionError(null);
      setSelectedId(created.id);
      void qc.invalidateQueries({ queryKey: ['platform', 'tickets'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const updateStatus = useMutation({
    mutationFn: (nextStatus: 'new' | 'open' | 'pending_customer' | 'resolved' | 'closed') =>
      unwrap(
        api.PATCH('/v1/platform/support-tickets/{id}', {
          params: { path: { id: selectedId! } },
          body: { status: nextStatus },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'tickets'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'ticket', selectedId] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const sendMessage = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/support-tickets/{id}/messages', {
          params: { path: { id: selectedId! } },
          body: { body: replyBody.trim(), internal: replyInternal },
        }),
      ),
    onSuccess: () => {
      setReplyBody('');
      setReplyInternal(false);
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'ticket', selectedId] });
      void qc.invalidateQueries({ queryKey: ['platform', 'tickets'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader
        title={t('admin.tickets.title')}
        description={t('admin.tickets.description')}
        actions={
          <ActionButton
            icon="ticket"
            onClick={() => {
              setActionError(null);
              setCreateOpen(true);
            }}
          >
            {t('admin.tickets.new')}
          </ActionButton>
        }
      />

      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as TicketStatus);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'new', label: 'New' },
            { value: 'open', label: 'Open' },
            { value: 'pending_customer', label: 'Pending customer' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <SelectField
          label="Priority"
          value={priority}
          onChange={(v) => {
            setPriority(v as TicketPriority);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All priorities' },
            { value: 'critical', label: 'Critical' },
            { value: 'high', label: 'High' },
            { value: 'normal', label: 'Normal' },
            { value: 'low', label: 'Low' },
          ]}
        />
      </Toolbar>

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Support tickets"
          loading={list.isPending}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'ticket', title: t('admin.tickets.empty') }}
          columns={[
            {
              key: 'subject',
              header: 'Subject',
              render: (row) => (
                <div>
                  <strong>{row.subject}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {humanizeStatus(row.category)}
                    {row.requesterName ? ` · ${row.requesterName}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'priority',
              header: 'Priority',
              render: (row) => (
                <StatusPill tone={statusTone(row.priority)} label={humanizeStatus(row.priority)} />
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            { key: 'sla', header: 'SLA due', render: (row) => formatWat(row.slaDueAt) },
            {
              key: 'action',
              header: '',
              render: (row) => (
                <ActionButton variant="outline" size="sm" onClick={() => setSelectedId(row.id)}>
                  Open
                </ActionButton>
              ),
            },
          ]}
        />
      )}

      {list.data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <ActionButton
            variant="outline"
            onClick={() => setCursor(list.data?.nextCursor ?? undefined)}
          >
            Load next page
          </ActionButton>
        </div>
      ) : null}

      {selectedId ? (
        <Drawer
          title={detail.data?.subject ?? 'Support ticket'}
          onClose={() => setSelectedId(null)}
        >
          {detail.isPending ? (
            <Skeleton height={160} />
          ) : detail.isError ? (
            <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <DetailList
                items={[
                  {
                    label: 'Status',
                    value: (
                      <StatusPill
                        tone={statusTone(detail.data.status)}
                        label={humanizeStatus(detail.data.status)}
                      />
                    ),
                  },
                  { label: 'Priority', value: humanizeStatus(detail.data.priority) },
                  { label: 'Category', value: humanizeStatus(detail.data.category) },
                  { label: 'SLA due', value: formatWat(detail.data.slaDueAt) },
                  { label: 'Requester', value: detail.data.requesterName ?? '-' },
                  { label: 'Contact', value: detail.data.requesterContact ?? '-' },
                ]}
              />

              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.data.description}</p>

              <SelectField
                label="Update status"
                value={detail.data.status}
                onChange={(v) =>
                  updateStatus.mutate(
                    v as 'new' | 'open' | 'pending_customer' | 'resolved' | 'closed',
                  )
                }
                options={[
                  { value: 'new', label: 'New' },
                  { value: 'open', label: 'Open' },
                  { value: 'pending_customer', label: 'Pending customer' },
                  { value: 'resolved', label: 'Resolved' },
                  { value: 'closed', label: 'Closed' },
                ]}
              />

              <div>
                <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 15 }}>Messages</h3>
                {detail.data.messages.length === 0 ? (
                  <p className="sz-muted">No messages yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detail.data.messages.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid var(--sz-border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: 12, marginBottom: 4 }} className="sz-muted">
                          {m.internal ? 'Internal note' : 'Reply'} · {formatWat(m.createdAt)}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{m.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <FormError message={actionError} />
              <TextAreaField
                label={t('admin.tickets.reply')}
                value={replyBody}
                onChange={setReplyBody}
                rows={3}
              />
              <CheckboxField
                label={t('admin.tickets.internalNote')}
                checked={replyInternal}
                onChange={setReplyInternal}
              />
              <ActionButton
                disabled={!replyBody.trim() || sendMessage.isPending}
                onClick={() => sendMessage.mutate()}
              >
                Post message
              </ActionButton>
            </div>
          )}
        </Drawer>
      ) : null}

      {createOpen ? (
        <Dialog
          title={t('admin.tickets.new')}
          onClose={() => setCreateOpen(false)}
          onSubmit={() => createTicket.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={
                  subject.trim().length < 3 ||
                  description.trim().length < 5 ||
                  createTicket.isPending
                }
              >
                Create ticket
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField label="Subject" value={subject} onChange={setSubject} required />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <SelectField
              label="Category"
              value={category}
              onChange={(v) =>
                setCategory(
                  v as 'gate_sos' | 'onboarding' | 'billing' | 'technical' | 'account' | 'other',
                )
              }
              options={[
                { value: 'gate_sos', label: 'Gate / SOS (1h SLA)' },
                { value: 'onboarding', label: 'Onboarding' },
                { value: 'billing', label: 'Billing' },
                { value: 'technical', label: 'Technical' },
                { value: 'account', label: 'Account' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <SelectField
              label="Priority"
              value={newPriority}
              onChange={(v) => setNewPriority(v as 'critical' | 'high' | 'normal' | 'low')}
              options={[
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'normal', label: 'Normal' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </div>
          <InputField
            label="Requester name (optional)"
            value={requesterName}
            onChange={setRequesterName}
          />
          <InputField
            label="Requester phone or email (optional)"
            value={requesterContact}
            onChange={setRequesterContact}
          />
          <TextAreaField
            label="Description"
            value={description}
            onChange={setDescription}
            required
            rows={4}
          />
        </Dialog>
      ) : null}
    </>
  );
}
