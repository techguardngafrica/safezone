import { unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, formatKobo, t } from '@safezone/i18n';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useManager } from '../lib/manager';
import { api } from '../lib/session';
import {
  type ApprovalFormat,
  type ApprovalItem,
  badgeLabel,
  toApprovalItems,
} from './approval-items';

export type { ApprovalItem, ApprovalKind } from './approval-items';

const POLL_MS = 60_000;

const format: ApprovalFormat = {
  unknownName: t('mm.approvals.unknownName'),
  relationship: (relationship) => t(`join.relationship.${relationship}` as MessageKey),
  money: formatKobo,
  dateTime: formatDateTime,
  runDetail: (invoices, amount) => t('mm.approvals.runDetail', { invoices, amount }),
};

/**
 * Every pending item this user can act on, and nothing they cannot (management-mobile.md §13): each
 * source is fetched only with its permission and the estate feature that owns it.
 */
export function useApprovals() {
  const { estateId, can, hasFeature, accessReady } = useManager();
  const allow = {
    join: accessReady && hasFeature('occupancy') && can('resident.approve'),
    billing: accessReady && hasFeature('billing') && can('billing.run.approve'),
    booking: accessReady && hasFeature('facilities') && can('facility.manage'),
  };
  const [joins, runs, waivers, bookings] = useQueries({
    queries: [
      {
        queryKey: ['estate', estateId, 'join-requests', 'awaiting_manager', 'inbox'],
        queryFn: () =>
          unwrapPage(
            api.GET('/v1/estates/{estateId}/join-requests', {
              params: { path: { estateId }, query: { status: 'awaiting_manager', limit: 50 } },
            }),
          ).then((page) => page.items),
        enabled: allow.join,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'billing-runs', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/billing-runs', { params: { path: { estateId } } }),
          ),
        enabled: allow.billing,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'waivers', 'pending', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/waivers', {
              params: { path: { estateId }, query: { status: 'pending' } },
            }),
          ),
        enabled: allow.billing,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'bookings', 'pending_approval', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/bookings', {
              params: { path: { estateId }, query: { status: 'pending_approval' } },
            }),
          ),
        enabled: allow.booking,
        refetchInterval: POLL_MS,
      },
    ],
  });
  const sources = [joins, runs, waivers, bookings];
  const items: ApprovalItem[] = toApprovalItems(
    { joins: joins.data, runs: runs.data, waivers: waivers.data, bookings: bookings.data },
    format,
  );
  const enabledSources = sources.filter((query) => query.fetchStatus !== 'idle' || query.data);
  return {
    items,
    /** True when the user may approve anything at all here. */
    anyAllowed: allow.join || allow.billing || allow.booking,
    isPending: enabledSources.some((query) => query.isPending),
    error: sources.find((query) => query.isError)?.error ?? null,
    refetch: () => Promise.all(sources.map((query) => query.refetch())),
  };
}

export function useApprovalCount(): { count: number; label: string } {
  const { items } = useApprovals();
  return { count: items.length, label: badgeLabel(items.length) };
}

export function useDecideApproval() {
  const { estateId } = useManager();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      item,
      action,
      reason,
    }: {
      item: ApprovalItem;
      action: 'approve' | 'reject';
      reason: string;
    }) => {
      const text = reason.trim();
      const path = { estateId, id: item.id };
      switch (item.kind) {
        case 'join':
          return action === 'approve'
            ? unwrap(
                api.POST('/v1/estates/{estateId}/join-requests/{id}/approve', {
                  params: { path },
                  body: text ? { reason: text } : {},
                }),
              )
            : unwrap(
                api.POST('/v1/estates/{estateId}/join-requests/{id}/reject', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'billing_run':
          return action === 'approve'
            ? unwrap(
                api.POST('/v1/estates/{estateId}/billing-runs/{id}/approve', { params: { path } }),
              )
            : unwrap(
                api.POST('/v1/estates/{estateId}/billing-runs/{id}/cancel', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'waiver': {
          const waiverPath = { estateId, id: item.invoiceId ?? '', waiverId: item.id };
          return action === 'approve'
            ? unwrap(
                api.POST('/v1/estates/{estateId}/invoices/{id}/waivers/{waiverId}/approve', {
                  params: { path: waiverPath },
                  body: text ? { reason: text } : {},
                }),
              )
            : unwrap(
                api.POST('/v1/estates/{estateId}/invoices/{id}/waivers/{waiverId}/reject', {
                  params: { path: waiverPath },
                  body: { reason: text },
                }),
              );
        }
        case 'booking':
          return action === 'approve'
            ? unwrap(api.POST('/v1/estates/{estateId}/bookings/{id}/approve', { params: { path } }))
            : unwrap(
                api.POST('/v1/estates/{estateId}/bookings/{id}/reject', {
                  params: { path },
                  body: { reason: text },
                }),
              );
      }
    },
    onSuccess: async () => {
      await Promise.all(
        ['join-requests', 'billing-runs', 'waivers', 'bookings', 'residents'].map((key) =>
          queryClient.invalidateQueries({ queryKey: ['estate', estateId, key] }),
        ),
      );
    },
  });
}
