'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  InputField,
  PageHeader,
  Panel,
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

type Tab = 'prs' | 'pos' | 'suppliers' | 'inventory' | 'assets';

export function ProcurementScreen() {
  const { estateId, can } = useEstate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('prs');
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [prDept, setPrDept] = useState('Maintenance');
  const [prReason, setPrReason] = useState('');
  const [prItemDesc, setPrItemDesc] = useState('');
  const [prItemCostNgn, setPrItemCostNgn] = useState('');
  const [sku, setSku] = useState('');
  const [itemName, setItemName] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [assetName, setAssetName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const report = useQuery({
    queryKey: ['estate', estateId, 'procurement', 'report'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/procurement', { params: { path: { estateId } } }),
      ),
  });

  const prs = useQuery({
    queryKey: ['estate', estateId, 'procurement', 'prs'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/purchase-requests', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
    enabled: tab === 'prs',
  });

  const pos = useQuery({
    queryKey: ['estate', estateId, 'procurement', 'pos'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/purchase-orders', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
    enabled: tab === 'pos',
  });

  const suppliers = useQuery({
    queryKey: ['estate', estateId, 'procurement', 'suppliers'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/suppliers', { params: { path: { estateId } } })),
    enabled: tab === 'suppliers',
  });

  const inventory = useQuery({
    queryKey: ['estate', estateId, 'procurement', 'inventory'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/inventory-items', { params: { path: { estateId } } })),
    enabled: tab === 'inventory',
  });

  const assets = useQuery({
    queryKey: ['estate', estateId, 'procurement', 'assets'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/assets', { params: { path: { estateId } } })),
    enabled: tab === 'assets',
  });

  const createSupplier = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/suppliers', {
          params: { path: { estateId } },
          body: { name: supName, phone: supPhone || undefined, categories: [] },
        }),
      ),
    onSuccess: () => {
      setSupName('');
      setSupPhone('');
      setFeedback('Supplier registered.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'procurement', 'suppliers'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createPr = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/purchase-requests', {
          params: { path: { estateId } },
          body: {
            department: prDept,
            reason: prReason,
            items: [
              {
                description: prItemDesc,
                qty: 1,
                estUnitCostKobo: Math.round(Number(prItemCostNgn) * 100),
              },
            ],
          },
        }),
      ),
    onSuccess: () => {
      setPrReason('');
      setPrItemDesc('');
      setPrItemCostNgn('');
      setFeedback('Draft purchase request created.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'procurement', 'prs'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const submitPr = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/purchase-requests/{id}/submit', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      setFeedback('Purchase request submitted for approval.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'procurement', 'prs'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const approvePr = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/purchase-requests/{id}/approve', {
          params: { path: { estateId, id } },
          body: {},
        }),
      ),
    onSuccess: () => {
      setFeedback('Approval step recorded.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'procurement', 'prs'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createInventory = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/inventory-items', {
          params: { path: { estateId } },
          body: {
            sku,
            name: itemName,
            category: 'General',
            unit: 'unit',
            reorderLevel: 5,
            isConsumable: false,
          },
        }),
      ),
    onSuccess: () => {
      setSku('');
      setItemName('');
      setFeedback('Inventory item added.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'procurement', 'inventory'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  const createAsset = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/assets', {
          params: { path: { estateId } },
          body: { tag: assetTag, name: assetName, category: 'Equipment', purchaseCostKobo: 0 },
        }),
      ),
    onSuccess: () => {
      setAssetTag('');
      setAssetName('');
      setFeedback('Asset registered.');
      void qc.invalidateQueries({ queryKey: ['estate', estateId, 'procurement', 'assets'] });
    },
    onError: (e) => setFeedback(errorText(e)),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('p5.procurement.title')} description={t('p5.procurement.description')} />
      {feedback ? (
        <Panel>
          <p style={{ margin: 0 }}>{feedback}</p>
        </Panel>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="Total Spend" value={formatKobo(report.data?.totalSpendKobo ?? 0)} />
        <StatCard label="Open POs" value={String(report.data?.openPoCount ?? 0)} />
        <StatCard
          label="Stock Valuation"
          value={formatKobo(report.data?.stockValuationKobo ?? 0)}
        />
        <StatCard label="Low Stock Items" value={String(report.data?.lowStockCount ?? 0)} />
        <StatCard label="Active Assets" value={String(report.data?.assetCount ?? 0)} />
      </div>

      <Tabs
        label="Procurement sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'prs', label: 'Purchase requests' },
          { key: 'pos', label: 'Purchase orders' },
          { key: 'suppliers', label: 'Suppliers' },
          { key: 'inventory', label: 'Inventory' },
          { key: 'assets', label: 'Assets' },
        ]}
      />

      {tab === 'prs' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('procurement.request') && (
            <Panel title="New purchase request">
              <Toolbar>
                <InputField label="Department" value={prDept} onChange={setPrDept} />
                <InputField label="Reason" value={prReason} onChange={setPrReason} />
                <InputField label="Item" value={prItemDesc} onChange={setPrItemDesc} />
                <InputField
                  label="Est. Cost (NGN)"
                  type="number"
                  value={prItemCostNgn}
                  onChange={setPrItemCostNgn}
                />
                <ActionButton
                  onClick={() => createPr.mutate()}
                  disabled={!prReason || !prItemDesc || !prItemCostNgn}
                >
                  Create PR
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Purchase requests"
            loading={prs.isLoading}
            rows={prs.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'number', header: 'Number', render: (r) => r.number },
              { key: 'dept', header: 'Department', render: (r) => r.department },
              { key: 'reason', header: 'Reason', render: (r) => r.reason },
              { key: 'total', header: 'Estimate', render: (r) => formatKobo(r.estimatedTotalKobo) },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPill
                    tone={r.status === 'approved' ? 'success' : 'info'}
                    label={r.status}
                  />
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (r) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {r.status === 'draft' && can('procurement.request') && (
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        onClick={() => submitPr.mutate(r.id)}
                      >
                        Submit
                      </ActionButton>
                    )}
                    {r.status === 'submitted' && can('procurement.approve') && (
                      <ActionButton
                        size="sm"
                        variant="secondary"
                        onClick={() => approvePr.mutate(r.id)}
                      >
                        Approve
                      </ActionButton>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {tab === 'pos' && (
        <DataTable
          caption="Purchase orders"
          loading={pos.isLoading}
          rows={pos.data?.items ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'number', header: 'PO Number', render: (r) => r.number },
            { key: 'supplier', header: 'Supplier', render: (r) => r.supplierName },
            { key: 'total', header: 'Total', render: (r) => formatKobo(r.totalKobo) },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <StatusPill tone="info" label={r.status} />,
            },
          ]}
        />
      )}

      {tab === 'suppliers' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('procurement.manage') && (
            <Panel title="Register supplier">
              <Toolbar>
                <InputField label="Name" value={supName} onChange={setSupName} />
                <InputField label="Phone" value={supPhone} onChange={setSupPhone} />
                <ActionButton onClick={() => createSupplier.mutate()} disabled={!supName}>
                  Add supplier
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Suppliers"
            loading={suppliers.isLoading}
            rows={suppliers.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'name', header: 'Supplier', render: (r) => r.name },
              { key: 'phone', header: 'Phone', render: (r) => r.phone ?? '-' },
              {
                key: 'status',
                header: 'Status',
                render: (r) => <StatusPill tone="success" label={r.status} />,
              },
            ]}
          />
        </div>
      )}

      {tab === 'inventory' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('inventory.manage') && (
            <Panel title="Add inventory item">
              <Toolbar>
                <InputField label="SKU" value={sku} onChange={setSku} />
                <InputField label="Item name" value={itemName} onChange={setItemName} />
                <ActionButton onClick={() => createInventory.mutate()} disabled={!sku || !itemName}>
                  Add item
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Inventory items"
            loading={inventory.isLoading}
            rows={inventory.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'sku', header: 'SKU', render: (r) => r.sku },
              { key: 'name', header: 'Name', render: (r) => r.name },
              { key: 'onHand', header: 'On Hand', render: (r) => `${r.onHand} ${r.unit}` },
              { key: 'avgCost', header: 'Avg Cost', render: (r) => formatKobo(r.avgCostKobo) },
              {
                key: 'low',
                header: 'Stock State',
                render: (r) => (
                  <StatusPill
                    tone={r.isLowStock ? 'warning' : 'success'}
                    label={r.isLowStock ? 'Low stock' : 'OK'}
                  />
                ),
              },
            ]}
          />
        </div>
      )}

      {tab === 'assets' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {can('asset.manage') && (
            <Panel title="Register asset">
              <Toolbar>
                <InputField label="Asset tag" value={assetTag} onChange={setAssetTag} />
                <InputField label="Asset name" value={assetName} onChange={setAssetName} />
                <ActionButton
                  onClick={() => createAsset.mutate()}
                  disabled={!assetTag || !assetName}
                >
                  Register asset
                </ActionButton>
              </Toolbar>
            </Panel>
          )}
          <DataTable
            caption="Asset register"
            loading={assets.isLoading}
            rows={assets.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'tag', header: 'Tag', render: (r) => r.tag },
              { key: 'name', header: 'Name', render: (r) => r.name },
              { key: 'category', header: 'Category', render: (r) => r.category },
              { key: 'cost', header: 'Cost', render: (r) => formatKobo(r.purchaseCostKobo) },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPill
                    tone={r.status === 'disposed' ? 'neutral' : 'success'}
                    label={r.status}
                  />
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
