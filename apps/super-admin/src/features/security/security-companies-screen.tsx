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
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';

export function SecurityCompaniesScreen() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const companies = useQuery({
    queryKey: ['platform', 'security-companies'],
    queryFn: () => unwrap(api.GET('/v1/platform/security-companies')),
  });

  const createCompany = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/security-companies', {
          body: { name, contactName, contactPhone },
        }),
      ),
    onSuccess: () => {
      setName('');
      setContactName('');
      setContactPhone('');
      setFeedback('Security company registered.');
      void qc.invalidateQueries({ queryKey: ['platform', 'security-companies'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title={t('p5.admin.companies.title')}
        description={t('p5.admin.companies.description')}
      />
      {feedback ? (
        <Panel>
          <p style={{ margin: 0 }}>{feedback}</p>
        </Panel>
      ) : null}

      <Panel title="Register security company">
        <Toolbar>
          <InputField label="Company name" value={name} onChange={setName} />
          <InputField label="Contact person" value={contactName} onChange={setContactName} />
          <InputField
            label="Contact phone"
            value={contactPhone}
            onChange={setContactPhone}
            placeholder="+234..."
          />
          <ActionButton
            onClick={() => createCompany.mutate()}
            disabled={!name || !contactName || !contactPhone || createCompany.isPending}
          >
            Register
          </ActionButton>
        </Toolbar>
      </Panel>

      <DataTable
        caption="Security companies"
        loading={companies.isLoading}
        rows={companies.data ?? []}
        rowKey={(r) => r.id}
        columns={[
          { key: 'name', header: 'Company', render: (r) => r.name },
          {
            key: 'contact',
            header: 'Contact',
            render: (r) => `${r.contactName} (${r.contactPhone})`,
          },
          { key: 'guards', header: 'Guards', render: (r) => String(r.guardCount) },
          {
            key: 'contracts',
            header: 'Active Contracts',
            render: (r) => String(r.activeContractCount),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <StatusPill tone={r.status === 'active' ? 'success' : 'warning'} label={r.status} />
            ),
          },
        ]}
      />
    </div>
  );
}
