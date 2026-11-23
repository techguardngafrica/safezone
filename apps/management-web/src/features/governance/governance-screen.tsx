'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  InputField,
  PageHeader,
  Panel,
  StatusPill,
  Tabs,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Tab = 'policies' | 'meetings' | 'motions' | 'committee' | 'disputes';

export function GovernanceScreen() {
  const { estateId, can } = useEstate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('policies');
  const [polTitle, setPolTitle] = useState('');
  const [polCategory, setPolCategory] = useState('Estate Rules');
  const [meetTitle, setMeetTitle] = useState('');
  const [motionTitle, setMotionTitle] = useState('');
  const [motionDesc, setMotionDesc] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const policies = useQuery({
    queryKey: ['estate', estateId, 'governance', 'policies'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/policies', { params: { path: { estateId } } })),
    enabled: tab === 'policies',
  });

  const meetings = useQuery({
    queryKey: ['estate', estateId, 'governance', 'meetings'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/meetings', { params: { path: { estateId } } })),
    enabled: tab === 'meetings',
  });

  const motions = useQuery({
    queryKey: ['estate', estateId, 'governance', 'motions'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/motions', { params: { path: { estateId } } })),
    enabled: tab === 'motions',
  });

  const committee = useQuery({
    queryKey: ['estate', estateId, 'governance', 'committee'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/committee', { params: { path: { estateId } } })),
    enabled: tab === 'committee',
  });

  const disputes = useQuery({
    queryKey: ['estate', estateId, 'governance', 'disputes'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/disputes', { params: { path: { estateId } } })),
    enabled: tab === 'disputes',
  });

  const createPolicy = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/policies', {
          params: { path: { estateId } },
          body: { title: polTitle, category: polCategory, requiresAck: true, audience: 'all' },
        }),
      ),
    onSuccess: () => {
      setPolTitle('');
      setFeedback('Draft policy created.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'governance', 'policies'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createMeeting = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/meetings', {
          params: { path: { estateId } },
          body: {
            type: 'agm',
            title: meetTitle,
            startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            agenda: [],
            quorumRule: 25,
          },
        }),
      ),
    onSuccess: () => {
      setMeetTitle('');
      setFeedback('Meeting scheduled.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'governance', 'meetings'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createMotion = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/motions', {
          params: { path: { estateId } },
          body: {
            title: motionTitle,
            description: motionDesc,
            options: ['Yes', 'No', 'Abstain'],
            eligibility: 'per_unit',
            ballot: 'secret',
            opensAt: new Date().toISOString(),
            closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            quorumCount: 1,
            threshold: 'simple',
          },
        }),
      ),
    onSuccess: () => {
      setMotionTitle('');
      setMotionDesc('');
      setFeedback('Motion opened for voting.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'governance', 'motions'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const closeMotion = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/motions/{id}/close', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: (res) => {
      setFeedback(`Motion closed (${res.status}). Total votes: ${res.totalVotes}.`);
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'governance', 'motions'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('p5.governance.title')} description={t('p5.governance.description')} />
      {feedback ? (
        <Panel>
          <p style={{ margin: 0 }}>{feedback}</p>
        </Panel>
      ) : null}

      <Tabs
        label="Governance sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'policies', label: 'Policies' },
          { key: 'meetings', label: 'Meetings & AGMs' },
          { key: 'motions', label: 'Motions & Voting' },
          { key: 'committee', label: 'Committee' },
          { key: 'disputes', label: 'Disputes' },
        ]}
      />

      {tab === 'policies' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('governance.manage') && (
            <Panel title="New policy">
              <Toolbar>
                <InputField label="Title" value={polTitle} onChange={setPolTitle} />
                <InputField label="Category" value={polCategory} onChange={setPolCategory} />
                <ActionButton onClick={() => createPolicy.mutate()} disabled={!polTitle}>
                  Create policy
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Estate policies"
            loading={policies.isLoading}
            rows={policies.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'title', header: 'Policy', render: (r) => r.title },
              { key: 'cat', header: 'Category', render: (r) => r.category },
              {
                key: 'ack',
                header: 'Acknowledgements',
                render: (r) => String(r.currentVersion?.ackCount ?? 0),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPill
                    tone={r.status === 'published' ? 'success' : 'neutral'}
                    label={r.status}
                  />
                ),
              },
            ]}
          />
        </div>
      )}

      {tab === 'meetings' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('governance.manage') && (
            <Panel title="Schedule AGM / Meeting">
              <Toolbar>
                <InputField label="Meeting title" value={meetTitle} onChange={setMeetTitle} />
                <ActionButton onClick={() => createMeeting.mutate()} disabled={!meetTitle}>
                  Schedule
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Governance meetings"
            loading={meetings.isLoading}
            rows={meetings.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'title', header: 'Title', render: (r) => r.title },
              { key: 'type', header: 'Type', render: (r) => r.type.toUpperCase() },
              { key: 'starts', header: 'Date', render: (r) => r.startsAt.slice(0, 10) },
              { key: 'att', header: 'Attendees', render: (r) => String(r.attendeeCount) },
              {
                key: 'status',
                header: 'Status',
                render: (r) => <StatusPill tone="info" label={r.status} />,
              },
            ]}
          />
        </div>
      )}

      {tab === 'motions' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('governance.manage') && (
            <Panel title="Open new motion">
              <Toolbar>
                <InputField label="Title" value={motionTitle} onChange={setMotionTitle} />
                <InputField label="Description" value={motionDesc} onChange={setMotionDesc} />
                <ActionButton
                  onClick={() => createMotion.mutate()}
                  disabled={!motionTitle || !motionDesc}
                >
                  Open motion
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Governance motions"
            loading={motions.isLoading}
            rows={motions.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'title', header: 'Motion', render: (r) => r.title },
              { key: 'elig', header: 'Eligibility', render: (r) => r.eligibility },
              { key: 'ballot', header: 'Ballot', render: (r) => r.ballot },
              { key: 'votes', header: 'Votes', render: (r) => String(r.totalVotes) },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPill tone={r.status === 'passed' ? 'success' : 'info'} label={r.status} />
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (r) =>
                  r.status === 'open' && can('governance.manage') ? (
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      onClick={() => closeMotion.mutate(r.id)}
                    >
                      Close &amp; Tally
                    </ActionButton>
                  ) : null,
              },
            ]}
          />
        </div>
      )}

      {tab === 'committee' && (
        <DataTable
          caption="Management committee"
          loading={committee.isLoading}
          rows={committee.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'pos', header: 'Position', render: (r) => r.position },
            { key: 'term', header: 'Term Start', render: (r) => r.termStart },
            { key: 'end', header: 'Term End', render: (r) => r.termEnd ?? 'Current' },
            {
              key: 'active',
              header: 'Status',
              render: (r) => (
                <StatusPill
                  tone={r.active ? 'success' : 'neutral'}
                  label={r.active ? 'Active' : 'Ended'}
                />
              ),
            },
          ]}
        />
      )}

      {tab === 'disputes' && (
        <DataTable
          caption="Governance disputes"
          loading={disputes.isLoading}
          rows={disputes.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'summary', header: 'Summary', render: (r) => r.summary },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <StatusPill tone="warning" label={r.status} />,
            },
            { key: 'created', header: 'Logged', render: (r) => r.createdAt.slice(0, 10) },
          ]}
        />
      )}
    </div>
  );
}
