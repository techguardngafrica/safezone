'use client';

import { type ApiData, type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  DetailList,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  type Tone,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';
import { useGates } from '../../../lib/use-gates';

type Incident = ApiRow<'/v1/estates/{estateId}/incidents', 'get'>;
type IncidentDetail = ApiData<'/v1/estates/{estateId}/incidents/{id}', 'get'>;

const SEVERITY_TONE: Record<Incident['severity'], Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

const STATUS_TONE: Record<Incident['status'], Tone> = {
  reported: 'warning',
  under_review: 'info',
  assigned: 'info',
  resolved: 'success',
  closed: 'neutral',
};

const CATEGORIES: Incident['category'][] = [
  'suspicious_activity',
  'unauthorised_access',
  'theft',
  'fight',
  'fire',
  'accident',
  'damage',
  'other',
];

const SEVERITIES: Incident['severity'][] = ['low', 'medium', 'high', 'critical'];

const STATUSES: Incident['status'][] = [
  'reported',
  'under_review',
  'assigned',
  'resolved',
  'closed',
];

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function IncidentsScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canManage = can('incident.manage');
  const { gates } = useGates();

  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  // Report form state
  const [title, setTitle] = useState('');
  const [repCategory, setRepCategory] = useState<Incident['category']>('suspicious_activity');
  const [repSeverity, setRepSeverity] = useState<Incident['severity']>('medium');
  const [locationKind, setLocationKind] = useState<Incident['locationKind']>('common_area');
  const [repGateId, setRepGateId] = useState('');
  const [locationText, setLocationText] = useState('');
  const [description, setDescription] = useState('');
  const [peopleInvolved, setPeopleInvolved] = useState('');

  // Detail actions state
  const [noteBody, setNoteBody] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [assignNote, setAssignNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolutionText, setResolutionText] = useState('');
  const [policeRef, setPoliceRef] = useState('');
  const [closing, setClosing] = useState(false);

  const list = usePaged<Incident>(
    ['estate', estateId, 'incidents', status, severity, category, search],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/incidents', {
          params: {
            path: { estateId },
            query: {
              status: (status || undefined) as Incident['status'] | undefined,
              severity: (severity || undefined) as Incident['severity'] | undefined,
              category: (category || undefined) as Incident['category'] | undefined,
              q: search.trim() || undefined,
              limit: 50,
              cursor,
            },
          },
        }),
      ),
  );

  const detail = useQuery({
    queryKey: ['estate', estateId, 'incidents', 'detail', selectedId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/incidents/{id}', {
          params: { path: { estateId, id: selectedId! } },
        }),
      ),
    enabled: Boolean(selectedId),
  });

  const guards = useQuery({
    queryKey: ['estate', estateId, 'guards'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/guards', { params: { path: { estateId } } })),
    enabled: canManage && can('security.staff.manage'),
  });

  const invalidate = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'incidents'] });
    if (id) {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'incidents', 'detail', id],
      });
    }
  };

  const report = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/incidents', {
          params: { path: { estateId } },
          body: {
            title: title.trim(),
            category: repCategory,
            severity: repSeverity,
            locationKind,
            gateId: locationKind === 'gate' ? repGateId || undefined : undefined,
            locationText:
              locationKind === 'common_area' || locationKind === 'other'
                ? locationText.trim() || undefined
                : undefined,
            description: description.trim(),
            peopleInvolved: peopleInvolved.trim() || undefined,
            occurredAt: new Date().toISOString(),
            evidenceFileIds: [],
          },
        }),
      ),
    onSuccess: (created) => {
      invalidate(created.id);
      setReporting(false);
      setTitle('');
      setLocationText('');
      setDescription('');
      setPeopleInvolved('');
      setSelectedId(created.id);
    },
  });

  const addNote = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/incidents/{id}/notes', {
          params: { path: { estateId, id: selectedId! } },
          body: { body: noteBody.trim() },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(['estate', estateId, 'incidents', 'detail', updated.id], updated);
      invalidate();
      setNoteBody('');
    },
  });

  const transition = useMutation({
    mutationFn: (body: {
      action: 'review' | 'assign' | 'resolve' | 'reopen' | 'close';
      version: number;
      assigneeId?: string;
      resolution?: string;
      policeReportRef?: string;
      note?: string;
    }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/incidents/{id}/transition', {
          params: { path: { estateId, id: selectedId! } },
          body,
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(['estate', estateId, 'incidents', 'detail', updated.id], updated);
      invalidate();
      setAssigning(false);
      setResolving(false);
      setClosing(false);
      setAssignNote('');
      setResolutionText('');
      setPoliceRef('');
    },
  });

  const exportDossier = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.GET('/v1/estates/{estateId}/incidents/{id}/export', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: (dossier) => {
      downloadJson(`incident-${dossier.incident.id.slice(0, 8)}-dossier.json`, dossier);
    },
  });

  const guardName = (userId: string | null) => {
    if (!userId) return '-';
    const found = (guards.data ?? []).find((g) => g.userId === userId);
    return found?.fullName ?? `${userId.slice(0, 8)}...`;
  };

  const reportErr = report.isError
    ? formErrors(report.error, {
        title: 'title',
        gateId: 'gateId',
        locationText: 'locationText',
        description: 'description',
      })
    : null;

  const columns: Column<Incident>[] = [
    {
      key: 'title',
      header: t('incident.col.title'),
      render: (row) => (
        <button
          type="button"
          className="sz-btn sz-btn-text"
          style={{ padding: 0, textAlign: 'left', fontWeight: 600 }}
          onClick={() => {
            transition.reset();
            setSelectedId(row.id);
          }}
        >
          {row.title}
        </button>
      ),
    },
    {
      key: 'category',
      header: t('incident.col.category'),
      render: (row) => t(`incident.category.${row.category}` as MessageKey),
    },
    {
      key: 'severity',
      header: t('incident.col.severity'),
      render: (row) => (
        <StatusPill
          tone={SEVERITY_TONE[row.severity]}
          label={t(`incident.severity.${row.severity}` as MessageKey)}
        />
      ),
    },
    {
      key: 'location',
      header: t('incident.col.location'),
      render: (row) =>
        row.gateName ??
        row.unitCode ??
        row.locationText ??
        t(`incident.location.${row.locationKind}` as MessageKey),
    },
    {
      key: 'status',
      header: t('incident.col.status'),
      render: (row) => (
        <StatusPill
          tone={STATUS_TONE[row.status]}
          label={t(`incident.status.${row.status}` as MessageKey)}
        />
      ),
    },
    {
      key: 'occurredAt',
      header: t('incident.col.occurredAt'),
      render: (row) => <span className="sz-num">{formatDateTime(row.occurredAt)}</span>,
    },
  ];

  const current: IncidentDetail | undefined = detail.data;

  return (
    <>
      <PageHeader
        title={t('incident.title')}
        description={t('incident.description')}
        actions={
          <ActionButton
            icon="plus"
            onClick={() => {
              report.reset();
              setReporting(true);
            }}
          >
            {t('incident.report')}
          </ActionButton>
        }
      />

      <Toolbar>
        <InputField
          label={t('common.search')}
          placeholder={t('incident.filter.search')}
          value={search}
          onChange={setSearch}
        />
        <SelectField
          label={t('incident.filter.status')}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: t('incident.filter.allStatuses') },
            ...STATUSES.map((item) => ({
              value: item,
              label: t(`incident.status.${item}` as MessageKey),
            })),
          ]}
        />
        <SelectField
          label={t('incident.filter.severity')}
          value={severity}
          onChange={setSeverity}
          options={[
            { value: '', label: t('incident.filter.allSeverities') },
            ...SEVERITIES.map((item) => ({
              value: item,
              label: t(`incident.severity.${item}` as MessageKey),
            })),
          ]}
        />
        <SelectField
          label={t('incident.filter.category')}
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: t('incident.filter.allCategories') },
            ...CATEGORIES.map((item) => ({
              value: item,
              label: t(`incident.category.${item}` as MessageKey),
            })),
          ]}
        />
      </Toolbar>

      <DataTable
        caption={t('incident.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'flag',
          title: t('incident.empty.title'),
          body: t('incident.empty.body'),
        }}
      />

      {reporting ? (
        <Dialog
          title={t('incident.report')}
          wide
          onClose={() => setReporting(false)}
          onSubmit={() => report.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setReporting(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" busy={report.isPending}>
                {t('incident.report')}
              </ActionButton>
            </>
          }
        >
          <FormError message={reportErr?.other.join(' ')} />
          <div className="sz-form">
            <InputField
              label={t('incident.field.title')}
              required
              value={title}
              onChange={setTitle}
              error={reportErr?.fields.title}
            />
            <div className="sz-form-2">
              <SelectField
                label={t('incident.field.category')}
                value={repCategory}
                onChange={setRepCategory}
                options={CATEGORIES.map((item) => ({
                  value: item,
                  label: t(`incident.category.${item}` as MessageKey),
                }))}
              />
              <SelectField
                label={t('incident.field.severity')}
                value={repSeverity}
                onChange={setRepSeverity}
                options={SEVERITIES.map((item) => ({
                  value: item,
                  label: t(`incident.severity.${item}` as MessageKey),
                }))}
              />
            </div>
            <div className="sz-form-2">
              <SelectField
                label={t('incident.field.locationKind')}
                value={locationKind}
                onChange={setLocationKind}
                options={[
                  { value: 'common_area', label: t('incident.location.common_area') },
                  { value: 'gate', label: t('incident.location.gate') },
                  { value: 'other', label: t('incident.location.other') },
                ]}
              />
              {locationKind === 'gate' ? (
                <SelectField
                  label={t('incident.field.gate')}
                  value={repGateId}
                  onChange={setRepGateId}
                  error={reportErr?.fields.gateId}
                  options={[
                    { value: '', label: t('visitorLog.filter.gate') },
                    ...gates.map((gate) => ({ value: gate.id, label: gate.name })),
                  ]}
                />
              ) : (
                <InputField
                  label={t('incident.field.locationText')}
                  required
                  value={locationText}
                  onChange={setLocationText}
                  error={reportErr?.fields.locationText}
                />
              )}
            </div>
            <TextAreaField
              label={t('incident.field.description')}
              required
              rows={4}
              value={description}
              onChange={setDescription}
              error={reportErr?.fields.description}
            />
            <InputField
              label={t('incident.field.peopleInvolved')}
              value={peopleInvolved}
              onChange={setPeopleInvolved}
            />
          </div>
        </Dialog>
      ) : null}

      {selectedId ? (
        <Drawer title={current?.title ?? t('incident.title')} onClose={() => setSelectedId(null)}>
          {detail.isError ? <Banner tone="danger">{errorText(detail.error)}</Banner> : null}
          {transition.isError ? <Banner tone="danger">{errorText(transition.error)}</Banner> : null}
          {exportDossier.isError ? (
            <Banner tone="danger">{errorText(exportDossier.error)}</Banner>
          ) : null}

          {current ? (
            <div style={{ display: 'grid', gap: 20 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusPill
                  tone={STATUS_TONE[current.status]}
                  label={t(`incident.status.${current.status}` as MessageKey)}
                />
                <StatusPill
                  tone={SEVERITY_TONE[current.severity]}
                  label={t(`incident.severity.${current.severity}` as MessageKey)}
                />
                {canManage ? (
                  <ActionButton
                    variant="outline"
                    size="sm"
                    icon="download"
                    busy={exportDossier.isPending}
                    onClick={() => exportDossier.mutate(current.id)}
                  >
                    {t('incident.detail.export')}
                  </ActionButton>
                ) : null}
              </div>

              {canManage && current.status !== 'closed' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {current.status === 'reported' ? (
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      busy={transition.isPending}
                      onClick={() =>
                        transition.mutate({ action: 'review', version: current.version })
                      }
                    >
                      {t('incident.action.review')}
                    </ActionButton>
                  ) : null}
                  {current.status === 'reported' ||
                  current.status === 'under_review' ||
                  current.status === 'assigned' ? (
                    <>
                      <ActionButton
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAssigneeId(current.assignedTo ?? guards.data?.[0]?.userId ?? '');
                          setAssigning(true);
                        }}
                      >
                        {t('incident.action.assign')}
                      </ActionButton>
                      <ActionButton size="sm" onClick={() => setResolving(true)}>
                        {t('incident.action.resolve')}
                      </ActionButton>
                    </>
                  ) : null}
                  {current.status === 'resolved' ? (
                    <>
                      <ActionButton
                        variant="outline"
                        size="sm"
                        busy={transition.isPending}
                        onClick={() =>
                          transition.mutate({ action: 'reopen', version: current.version })
                        }
                      >
                        {t('incident.action.reopen')}
                      </ActionButton>
                      <ActionButton variant="danger" size="sm" onClick={() => setClosing(true)}>
                        {t('incident.action.close')}
                      </ActionButton>
                    </>
                  ) : null}
                </div>
              ) : null}

              <DetailList
                items={[
                  {
                    label: t('incident.col.category'),
                    value: t(`incident.category.${current.category}` as MessageKey),
                  },
                  {
                    label: t('incident.col.location'),
                    value:
                      current.gateName ??
                      current.unitCode ??
                      current.locationText ??
                      t(`incident.location.${current.locationKind}` as MessageKey),
                  },
                  {
                    label: t('incident.col.occurredAt'),
                    value: formatDateTime(current.occurredAt),
                  },
                  { label: t('incident.detail.reporter'), value: current.reporterType },
                  {
                    label: t('incident.detail.assignee'),
                    value: guardName(current.assignedTo),
                  },
                  ...(current.policeReportRef
                    ? [{ label: t('incident.detail.policeRef'), value: current.policeReportRef }]
                    : []),
                  ...(current.resolution
                    ? [{ label: t('incident.detail.resolution'), value: current.resolution }]
                    : []),
                ]}
              />

              <div>
                <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>
                  {t('incident.field.description')}
                </h3>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{current.description}</p>
              </div>

              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
                  {t('incident.detail.evidence', { count: current.evidence.length })}
                </h3>
                {current.evidence.length === 0 ? (
                  <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                    -
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
                    {current.evidence.map((ev) => (
                      <li key={ev.id} style={{ fontSize: 13 }}>
                        <span className="sz-num">{ev.fileId.slice(0, 8)}</span>
                        {ev.sha256 ? (
                          <span className="sz-muted"> · SHA-256 {ev.sha256.slice(0, 12)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('incident.detail.timeline')}</h3>
                <ol className="sz-timeline">
                  {current.notes.map((note) => (
                    <li key={note.id}>
                      <div style={{ fontSize: 13 }} className="sz-muted">
                        <span className="sz-num">{formatDateTime(note.createdAt)}</span>
                        {note.kind === 'status' && note.toStatus ? (
                          <>
                            {' · '}
                            {t(`incident.status.${note.toStatus}` as MessageKey)}
                          </>
                        ) : null}
                      </div>
                      {note.body ? <div style={{ marginTop: 2 }}>{note.body}</div> : null}
                    </li>
                  ))}
                </ol>
              </div>

              {current.status !== 'closed' ? (
                <form
                  className="sz-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (noteBody.trim()) addNote.mutate();
                  }}
                >
                  <TextAreaField
                    label={t('incident.detail.addNote')}
                    rows={3}
                    value={noteBody}
                    onChange={setNoteBody}
                  />
                  <div>
                    <ActionButton
                      type="submit"
                      size="sm"
                      disabled={!noteBody.trim()}
                      busy={addNote.isPending}
                    >
                      {t('incident.detail.addNote')}
                    </ActionButton>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {assigning && current ? (
        <Dialog
          title={t('incident.assign.title')}
          onClose={() => setAssigning(false)}
          onSubmit={() =>
            transition.mutate({
              action: 'assign',
              version: current.version,
              assigneeId,
              note: assignNote.trim() || undefined,
            })
          }
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setAssigning(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" disabled={!assigneeId} busy={transition.isPending}>
                {t('incident.action.assign')}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <SelectField
              label={t('incident.assign.guard')}
              value={assigneeId}
              onChange={setAssigneeId}
              options={[
                { value: '', label: t('incident.assign.guard') },
                ...(guards.data ?? []).map((guard) => ({
                  value: guard.userId,
                  label: guard.fullName ?? guard.phone,
                })),
              ]}
            />
            <TextAreaField
              label={t('incident.assign.note')}
              rows={3}
              value={assignNote}
              onChange={setAssignNote}
            />
          </div>
        </Dialog>
      ) : null}

      {resolving && current ? (
        <Dialog
          title={t('incident.resolve.title')}
          onClose={() => setResolving(false)}
          onSubmit={() =>
            transition.mutate({
              action: 'resolve',
              version: current.version,
              resolution: resolutionText.trim(),
              policeReportRef: policeRef.trim() || undefined,
            })
          }
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setResolving(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={resolutionText.trim().length < 3}
                busy={transition.isPending}
              >
                {t('incident.action.resolve')}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <TextAreaField
              label={t('incident.resolve.resolution')}
              required
              rows={4}
              value={resolutionText}
              onChange={setResolutionText}
            />
            <InputField
              label={t('incident.resolve.policeRef')}
              value={policeRef}
              onChange={setPoliceRef}
            />
          </div>
        </Dialog>
      ) : null}

      {closing && current ? (
        <ConfirmDialog
          title={t('incident.action.close')}
          body={t('incident.close.confirm')}
          confirmLabel={t('incident.action.close')}
          destructive
          busy={transition.isPending}
          error={transition.isError ? errorText(transition.error) : null}
          onClose={() => setClosing(false)}
          onConfirm={() => transition.mutate({ action: 'close', version: current.version })}
        />
      ) : null}
    </>
  );
}
