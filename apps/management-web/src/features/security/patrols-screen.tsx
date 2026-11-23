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

type Tab = 'routes' | 'runs' | 'contracts';

export function PatrolsScreen() {
  const { estateId, can } = useEstate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('routes');
  const [routeName, setRouteName] = useState('');
  const [cpName, setCpName] = useState('');
  const [cpCode, setCpCode] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const routes = useQuery({
    queryKey: ['estate', estateId, 'patrols', 'routes'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/patrol-routes', { params: { path: { estateId } } })),
    enabled: tab === 'routes',
  });

  const runs = useQuery({
    queryKey: ['estate', estateId, 'patrols', 'runs'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/patrol-runs', { params: { path: { estateId } } })),
    enabled: tab === 'runs',
  });

  const contracts = useQuery({
    queryKey: ['estate', estateId, 'security-contracts'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/security-contracts', { params: { path: { estateId } } }),
      ),
    enabled: tab === 'contracts',
  });

  const createRoute = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/patrol-routes', {
          params: { path: { estateId } },
          body: {
            name: routeName,
            intervalMinutes: 60,
            checkpoints: [{ sequence: 1, name: cpName, tagType: 'qr', tagCode: cpCode }],
          },
        }),
      ),
    onSuccess: () => {
      setRouteName('');
      setCpName('');
      setCpCode('');
      setFeedback('Patrol route created.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'patrols', 'routes'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const approveContract = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/security-contracts/{id}/approve', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      setFeedback('Security company contract approved.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'security-contracts'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('p5.patrols.title')} description={t('p5.patrols.description')} />
      {feedback ? (
        <Panel>
          <p style={{ margin: 0 }}>{feedback}</p>
        </Panel>
      ) : null}

      <Tabs
        label="Patrol sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'routes', label: 'Patrol routes' },
          { key: 'runs', label: 'Patrol runs' },
          { key: 'contracts', label: 'Security company contracts' },
        ]}
      />

      {tab === 'routes' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('patrol.manage') && (
            <Panel title="New patrol route">
              <Toolbar>
                <InputField label="Route name" value={routeName} onChange={setRouteName} />
                <InputField label="First checkpoint" value={cpName} onChange={setCpName} />
                <InputField
                  label="QR/NFC tag code"
                  value={cpCode}
                  onChange={setCpCode}
                  placeholder="CP-GATE-01"
                />
                <ActionButton
                  onClick={() => createRoute.mutate()}
                  disabled={!routeName || !cpName || !cpCode}
                >
                  Create route
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Patrol routes"
            loading={routes.isLoading}
            rows={routes.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'name', header: 'Route', render: (r) => r.name },
              {
                key: 'interval',
                header: 'Interval (min)',
                render: (r) => String(r.intervalMinutes),
              },
              { key: 'cps', header: 'Checkpoints', render: (r) => String(r.checkpoints.length) },
              {
                key: 'active',
                header: 'Status',
                render: (r) => (
                  <StatusPill
                    tone={r.active ? 'success' : 'neutral'}
                    label={r.active ? 'Active' : 'Inactive'}
                  />
                ),
              },
            ]}
          />
        </div>
      )}

      {tab === 'runs' && (
        <DataTable
          caption="Patrol runs"
          loading={runs.isLoading}
          rows={runs.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'route', header: 'Route', render: (r) => r.routeName },
            {
              key: 'progress',
              header: 'Checkpoints',
              render: (r) => `${r.scannedCount}/${r.totalCheckpoints}`,
            },
            {
              key: 'started',
              header: 'Started',
              render: (r) => r.startedAt.slice(0, 16).replace('T', ' '),
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusPill
                  tone={r.status === 'completed' ? 'success' : 'warning'}
                  label={r.status}
                />
              ),
            },
          ]}
        />
      )}

      {tab === 'contracts' && (
        <DataTable
          caption="Security company contracts"
          loading={contracts.isLoading}
          rows={contracts.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'company', header: 'Security Company', render: (r) => r.companyName },
            { key: 'starts', header: 'Starts On', render: (r) => r.startsOn },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusPill tone={r.status === 'active' ? 'success' : 'warning'} label={r.status} />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (r) =>
                r.status === 'pending' && can('patrol.manage') ? (
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    onClick={() => approveContract.mutate(r.id)}
                  >
                    Approve contract
                  </ActionButton>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}
