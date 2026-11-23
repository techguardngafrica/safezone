'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
  StatCard,
  StatusPill,
  Tabs,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Tab = 'accounts' | 'journals' | 'expenses' | 'payables' | 'periods' | 'statements';

function defaultRange() {
  const to = new Date().toISOString().slice(0, 10);
  const from = `${to.slice(0, 8)}01`;
  return { from, to };
}

export function AccountingScreen() {
  const { estateId, can } = useEstate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('accounts');
  const range = defaultRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [acctCode, setAcctCode] = useState('');
  const [acctName, setAcctName] = useState('');
  const [acctType, setAcctType] = useState<'asset' | 'liability' | 'income' | 'expense' | 'equity'>(
    'expense',
  );
  const [periodName, setPeriodName] = useState('');
  const [periodStart, setPeriodStart] = useState(range.from);
  const [periodEnd, setPeriodEnd] = useState(range.to);
  const [expVendor, setExpVendor] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expAmountNgn, setExpAmountNgn] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'accounts'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/accounting/accounts', { params: { path: { estateId } } }),
      ),
  });

  const journals = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'journals', from, to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/accounting/journals', {
          params: { path: { estateId }, query: { from, to } },
        }),
      ),
    enabled: tab === 'journals',
  });

  const expenses = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'expenses'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/accounting/expenses', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
    enabled: tab === 'expenses',
  });

  const payables = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'payables'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/accounting/payables', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
    enabled: tab === 'payables',
  });

  const periods = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'periods'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/accounting/periods', { params: { path: { estateId } } }),
      ),
    enabled: tab === 'periods',
  });

  const incomeStatement = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'income', from, to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/accounting/statements/income', {
          params: { path: { estateId }, query: { from, to } },
        }),
      ),
    enabled: tab === 'statements',
  });

  const balanceSheet = useQuery({
    queryKey: ['estate', estateId, 'accounting', 'balance-sheet', to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/accounting/statements/balance-sheet', {
          params: { path: { estateId }, query: { asOf: to } },
        }),
      ),
    enabled: tab === 'statements',
  });

  const createAccount = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/accounting/accounts', {
          params: { path: { estateId } },
          body: { code: acctCode, name: acctName, type: acctType },
        }),
      ),
    onSuccess: () => {
      setAcctCode('');
      setAcctName('');
      setFeedback('Account added to Chart of Accounts.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'accounting', 'accounts'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createPeriod = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/accounting/periods', {
          params: { path: { estateId } },
          body: { name: periodName, startsOn: periodStart, endsOn: periodEnd },
        }),
      ),
    onSuccess: () => {
      setPeriodName('');
      setFeedback('Financial period created.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'accounting', 'periods'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const closePeriod = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/accounting/periods/{id}/close', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      setFeedback('Financial period closed.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'accounting', 'periods'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createExpense = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/accounting/expenses', {
          params: { path: { estateId } },
          body: {
            categoryAccountCode: 'expense:admin',
            cashAccountCode: 'cash:bank',
            vendorName: expVendor,
            description: expDesc,
            amountKobo: Math.round(Number(expAmountNgn) * 100),
            incurredOn: to,
          },
        }),
      ),
    onSuccess: () => {
      setExpVendor('');
      setExpDesc('');
      setExpAmountNgn('');
      setFeedback('Expense submitted for approval.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'accounting', 'expenses'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const approveExpense = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/accounting/expenses/{id}/approve', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      setFeedback('Expense approved and posted to the general ledger.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'accounting', 'expenses'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const approvePayable = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/accounting/payables/{id}/approve', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      setFeedback('Payable approved and posted.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'accounting', 'payables'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const exportCsv = useMutation({
    mutationFn: (kind: 'journals' | 'trial_balance') =>
      unwrap(
        api.GET('/v1/estates/{estateId}/accounting/export', {
          params: { path: { estateId }, query: { from, to, kind } },
        }),
      ),
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = res.filename;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('p5.accounting.title')} description={t('p5.accounting.description')} />
      {feedback ? (
        <Panel>
          <p style={{ margin: 0 }}>{feedback}</p>
        </Panel>
      ) : null}

      <Tabs
        label="Accounting sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'accounts', label: 'Chart of accounts' },
          { key: 'journals', label: 'Journals' },
          { key: 'expenses', label: 'Expenses' },
          { key: 'payables', label: 'Payables' },
          { key: 'periods', label: 'Periods' },
          { key: 'statements', label: 'Statements & Export' },
        ]}
      />

      {tab === 'accounts' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('accounting.manage') && (
            <Panel title="Add account">
              <Toolbar>
                <InputField
                  label="Code"
                  value={acctCode}
                  onChange={setAcctCode}
                  placeholder="expense:diesel"
                />
                <InputField
                  label="Name"
                  value={acctName}
                  onChange={setAcctName}
                  placeholder="Generator Diesel"
                />
                <SelectField
                  label="Type"
                  value={acctType}
                  onChange={setAcctType}
                  options={[
                    { value: 'asset', label: 'Asset' },
                    { value: 'liability', label: 'Liability' },
                    { value: 'equity', label: 'Equity' },
                    { value: 'income', label: 'Income' },
                    { value: 'expense', label: 'Expense' },
                  ]}
                />
                <ActionButton
                  onClick={() => createAccount.mutate()}
                  disabled={!acctCode || !acctName || createAccount.isPending}
                >
                  Create account
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          {accounts.isLoading ? (
            <Skeleton height={180} />
          ) : accounts.isError ? (
            <ErrorState message={errorText(accounts.error)} />
          ) : (
            <DataTable
              caption="Chart of accounts"
              rows={accounts.data ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'code', header: 'Code', render: (r) => r.code },
                { key: 'name', header: 'Name', render: (r) => r.name },
                { key: 'type', header: 'Type', render: (r) => r.type },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => (
                    <StatusPill
                      tone={r.archivedAt ? 'neutral' : 'success'}
                      label={r.archivedAt ? 'Archived' : 'Active'}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      )}

      {tab === 'journals' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Toolbar>
            <InputField label="From" type="date" value={from} onChange={setFrom} />
            <InputField label="To" type="date" value={to} onChange={setTo} />
          </Toolbar>
          <DataTable
            caption="General ledger journals"
            loading={journals.isLoading}
            rows={journals.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'postedAt', header: 'Posted', render: (r) => r.postedAt.slice(0, 10) },
              { key: 'type', header: 'Type', render: (r) => r.type },
              { key: 'description', header: 'Description', render: (r) => r.description },
              { key: 'lines', header: 'Lines', render: (r) => String(r.lines.length) },
            ]}
          />
        </div>
      )}

      {tab === 'expenses' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('accounting.payable.manage') && (
            <Panel title="Submit expense">
              <Toolbar>
                <InputField label="Vendor" value={expVendor} onChange={setExpVendor} />
                <InputField label="Description" value={expDesc} onChange={setExpDesc} />
                <InputField
                  label="Amount (NGN)"
                  type="number"
                  value={expAmountNgn}
                  onChange={setExpAmountNgn}
                />
                <ActionButton
                  onClick={() => createExpense.mutate()}
                  disabled={!expVendor || !expDesc || !expAmountNgn || createExpense.isPending}
                >
                  Submit
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Estate expenses"
            loading={expenses.isLoading}
            rows={expenses.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'number', header: 'Number', render: (r) => r.number },
              { key: 'vendor', header: 'Vendor', render: (r) => r.vendorName },
              { key: 'amount', header: 'Amount', render: (r) => formatKobo(r.amountKobo) },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPill
                    tone={r.status === 'posted' ? 'success' : 'warning'}
                    label={r.status}
                  />
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (r) =>
                  r.status === 'submitted' && can('accounting.payable.approve') ? (
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      onClick={() => approveExpense.mutate(r.id)}
                    >
                      Approve
                    </ActionButton>
                  ) : null,
              },
            ]}
          />
        </div>
      )}

      {tab === 'payables' && (
        <DataTable
          caption="Supplier payables"
          loading={payables.isLoading}
          rows={payables.data?.items ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'number', header: 'Number', render: (r) => r.number },
            { key: 'supplier', header: 'Supplier', render: (r) => r.supplierName },
            { key: 'ref', header: 'Invoice Ref', render: (r) => r.invoiceRef },
            { key: 'amount', header: 'Amount', render: (r) => formatKobo(r.amountKobo) },
            { key: 'balance', header: 'Balance', render: (r) => formatKobo(r.balanceKobo) },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <StatusPill tone={r.status === 'paid' ? 'success' : 'info'} label={r.status} />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (r) =>
                (r.status === 'draft' || r.status === 'matched') &&
                can('accounting.payable.approve') ? (
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    onClick={() => approvePayable.mutate(r.id)}
                  >
                    Approve
                  </ActionButton>
                ) : null,
            },
          ]}
        />
      )}

      {tab === 'periods' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('accounting.manage') && (
            <Panel title="New financial period">
              <Toolbar>
                <InputField
                  label="Name"
                  value={periodName}
                  onChange={setPeriodName}
                  placeholder="Nov 2026"
                />
                <InputField
                  label="Starts on"
                  type="date"
                  value={periodStart}
                  onChange={setPeriodStart}
                />
                <InputField label="Ends on" type="date" value={periodEnd} onChange={setPeriodEnd} />
                <ActionButton onClick={() => createPeriod.mutate()} disabled={!periodName}>
                  Create period
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Financial periods"
            loading={periods.isLoading}
            rows={periods.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'name', header: 'Period', render: (r) => r.name },
              { key: 'range', header: 'Dates', render: (r) => `${r.startsOn} to ${r.endsOn}` },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPill
                    tone={r.status === 'closed' ? 'neutral' : 'success'}
                    label={r.status}
                  />
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (r) =>
                  r.status === 'open' && can('accounting.manage') ? (
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      onClick={() => closePeriod.mutate(r.id)}
                    >
                      Close period
                    </ActionButton>
                  ) : null,
              },
            ]}
          />
        </div>
      )}

      {tab === 'statements' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Toolbar>
            <InputField label="From" type="date" value={from} onChange={setFrom} />
            <InputField label="To / As of" type="date" value={to} onChange={setTo} />
            <ActionButton variant="secondary" onClick={() => exportCsv.mutate('journals')}>
              Export Journals CSV
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => exportCsv.mutate('trial_balance')}>
              Export Trial Balance CSV
            </ActionButton>
          </Toolbar>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <StatCard
              label="Total Income"
              value={formatKobo(incomeStatement.data?.totalIncomeKobo ?? 0)}
            />
            <StatCard
              label="Total Expenses"
              value={formatKobo(incomeStatement.data?.totalExpensesKobo ?? 0)}
            />
            <StatCard
              label="Net Income"
              value={formatKobo(incomeStatement.data?.netIncomeKobo ?? 0)}
            />
            <StatCard
              label="Total Assets"
              value={formatKobo(balanceSheet.data?.totalAssetsKobo ?? 0)}
            />
            <StatCard
              label="Total Liabilities"
              value={formatKobo(balanceSheet.data?.totalLiabilitiesKobo ?? 0)}
            />
            <StatCard
              label="Total Equity"
              value={formatKobo(balanceSheet.data?.totalEquityKobo ?? 0)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
