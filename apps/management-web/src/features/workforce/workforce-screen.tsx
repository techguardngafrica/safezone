'use client';

import { unwrap } from '@safezone/api-client';
import { formatKobo, t } from '@safezone/i18n';
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

type Tab = 'profiles' | 'departments' | 'attendance' | 'leave' | 'payroll';

export function WorkforceScreen() {
  const { estateId, can } = useEstate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('profiles');
  const [deptName, setDeptName] = useState('');
  const [payrollPeriod, setPayrollPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [feedback, setFeedback] = useState<string | null>(null);

  const profiles = useQuery({
    queryKey: ['estate', estateId, 'workforce', 'profiles'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/workforce/profiles', { params: { path: { estateId } } }),
      ),
    enabled: tab === 'profiles',
  });

  const departments = useQuery({
    queryKey: ['estate', estateId, 'workforce', 'departments'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/departments', { params: { path: { estateId } } })),
    enabled: tab === 'departments',
  });

  const attendance = useQuery({
    queryKey: ['estate', estateId, 'workforce', 'attendance'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/workforce/attendance', { params: { path: { estateId } } }),
      ),
    enabled: tab === 'attendance',
  });

  const leaveRequests = useQuery({
    queryKey: ['estate', estateId, 'workforce', 'leave'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/leave-requests', { params: { path: { estateId } } })),
    enabled: tab === 'leave',
  });

  const payrollExports = useQuery({
    queryKey: ['estate', estateId, 'workforce', 'payroll-exports'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/payroll-exports', { params: { path: { estateId } } })),
    enabled: tab === 'payroll' && can('payroll.view'),
  });

  const createDept = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/departments', {
          params: { path: { estateId } },
          body: { name: deptName },
        }),
      ),
    onSuccess: () => {
      setDeptName('');
      setFeedback('Department created.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'workforce', 'departments'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const approveLeave = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/leave-requests/{id}/approve', {
          params: { path: { estateId, id } },
          body: {},
        }),
      ),
    onSuccess: () => {
      setFeedback('Leave request approved.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'workforce', 'leave'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const generatePayroll = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/payroll-exports', {
          params: { path: { estateId } },
          body: { period: payrollPeriod },
        }),
      ),
    onSuccess: (res) => {
      setFeedback(`Payroll CSV generated for ${res.period} (${res.staffCount} staff).`);
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'workforce', 'payroll-exports'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'profiles', label: 'Staff profiles' },
    { key: 'departments', label: 'Departments' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'leave', label: 'Leave requests' },
    ...(can('payroll.view') ? [{ key: 'payroll' as const, label: 'Payroll' }] : []),
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('p5.workforce.title')} description={t('p5.workforce.description')} />
      {feedback ? (
        <Panel>
          <p style={{ margin: 0 }}>{feedback}</p>
        </Panel>
      ) : null}

      <Tabs label="Workforce sections" value={tab} onChange={setTab} tabs={tabItems} />

      {tab === 'profiles' && (
        <DataTable
          caption="Staff profiles"
          loading={profiles.isLoading}
          rows={profiles.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'num', header: 'Staff #', render: (r) => r.staffNumber },
            { key: 'title', header: 'Job Title', render: (r) => r.jobTitle },
            { key: 'dept', header: 'Department', render: (r) => r.departmentName ?? '-' },
            { key: 'type', header: 'Type', render: (r) => r.employmentType },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusPill tone={r.status === 'active' ? 'success' : 'neutral'} label={r.status} />
              ),
            },
          ]}
        />
      )}

      {tab === 'departments' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('workforce.manage') && (
            <Panel title="Add department">
              <Toolbar>
                <InputField label="Department name" value={deptName} onChange={setDeptName} />
                <ActionButton onClick={() => createDept.mutate()} disabled={!deptName}>
                  Create
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Departments"
            loading={departments.isLoading}
            rows={departments.data ?? []}
            rowKey={(r) => r.id}
            columns={[{ key: 'name', header: 'Department', render: (r) => r.name }]}
          />
        </div>
      )}

      {tab === 'attendance' && (
        <DataTable
          caption="Attendance records"
          loading={attendance.isLoading}
          rows={attendance.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'clockIn', header: 'Clock In', render: (r) => r.clockIn },
            { key: 'clockOut', header: 'Clock Out', render: (r) => r.clockOut ?? 'Active' },
            { key: 'source', header: 'Source', render: (r) => r.source },
            {
              key: 'dur',
              header: 'Minutes',
              render: (r) => (r.durationMinutes !== null ? String(r.durationMinutes) : '-'),
            },
          ]}
        />
      )}

      {tab === 'leave' && (
        <DataTable
          caption="Leave requests"
          loading={leaveRequests.isLoading}
          rows={leaveRequests.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'type', header: 'Leave Type', render: (r) => r.leaveTypeName },
            {
              key: 'dates',
              header: 'Dates',
              render: (r) => `${r.startsOn} to ${r.endsOn} (${r.days}d)`,
            },
            { key: 'reason', header: 'Reason', render: (r) => r.reason },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusPill
                  tone={r.status === 'approved' ? 'success' : 'warning'}
                  label={r.status}
                />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (r) =>
                r.status === 'pending' && can('workforce.leave.approve') ? (
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    onClick={() => approveLeave.mutate(r.id)}
                  >
                    Approve
                  </ActionButton>
                ) : null,
            },
          ]}
        />
      )}

      {tab === 'payroll' && can('payroll.view') && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Panel title="Generate payroll CSV">
            <Toolbar>
              <InputField
                label="Period (YYYY-MM)"
                value={payrollPeriod}
                onChange={setPayrollPeriod}
              />
              <ActionButton onClick={() => generatePayroll.mutate()}>Generate CSV</ActionButton>
            </Toolbar>
          </Panel>
          <DataTable
            caption="Payroll exports"
            loading={payrollExports.isLoading}
            rows={payrollExports.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'period', header: 'Period', render: (r) => r.period },
              { key: 'staff', header: 'Staff Count', render: (r) => String(r.staffCount) },
              { key: 'net', header: 'Total Net Pay', render: (r) => formatKobo(r.totalNetKobo) },
              { key: 'created', header: 'Generated', render: (r) => r.createdAt.slice(0, 10) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
