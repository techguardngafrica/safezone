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

export type { ApprovalCategory, ApprovalItem, ApprovalKind } from './approval-items';

const POLL_MS = 60_000;

const format: ApprovalFormat = {
  unknownName: t('mm.approvals.unknownName'),
  relationship: (relationship) => t(`join.relationship.${relationship}` as MessageKey),
  money: formatKobo,
  dateTime: formatDateTime,
  runDetail: (invoices, amount) => t('mm.approvals.runDetail', { invoices, amount }),
  moveType: (type) =>
    type === 'move_in' || type === 'move_out'
      ? t(`mm.approvals.moveType.${type}` as MessageKey)
      : type,
  moveDetail: (type, unit, date) => t('mm.approvals.moveDetail', { type, unit, date }),
  transferDetail: (unit, type) => t('mm.approvals.transferDetail', { unit, type }),
  paymentDetail: (method, ref) => t('mm.approvals.paymentDetail', { method, ref }),
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
    manualPayment:
      accessReady &&
      hasFeature('billing') &&
      (can('billing.run.approve') || can('payment.reconcile')),
    booking: accessReady && hasFeature('facilities') && can('facility.manage'),
    community: accessReady && hasFeature('community') && can('community.moderate'),
  };
  const [
    joins,
    runs,
    waivers,
    manualPayments,
    refunds,
    bookings,
    domesticStaff,
    moves,
    channels,
    ownershipTransfers,
  ] = useQueries({
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
        queryKey: ['estate', estateId, 'manual-payments', 'pending', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/manual-payments', {
              params: { path: { estateId }, query: { status: 'pending' } },
            }),
          ),
        enabled: allow.manualPayment,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'refunds', 'pending', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/refunds', {
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
      {
        queryKey: ['estate', estateId, 'domestic-staff', 'pending', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/domestic-staff', {
              params: { path: { estateId }, query: { status: 'pending' } },
            }),
          ),
        enabled: allow.join,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'moves', 'scheduled', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/moves', {
              params: { path: { estateId }, query: { status: 'scheduled' } },
            }),
          ),
        enabled: allow.join,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'channels', 'inbox'],
        queryFn: () =>
          unwrap(api.GET('/v1/estates/{estateId}/channels', { params: { path: { estateId } } })),
        enabled: allow.community,
        refetchInterval: POLL_MS,
      },
      {
        queryKey: ['estate', estateId, 'ownership-transfers', 'inbox'],
        queryFn: () =>
          unwrap(
            api.GET('/v1/estates/{estateId}/ownership-transfers', {
              params: { path: { estateId } },
            }),
          ),
        enabled: allow.join,
        refetchInterval: POLL_MS,
      },
    ],
  });
  const sources = [
    joins,
    runs,
    waivers,
    manualPayments,
    refunds,
    bookings,
    domesticStaff,
    moves,
    channels,
    ownershipTransfers,
  ];
  const items: ApprovalItem[] = toApprovalItems(
    {
      joins: joins.data,
      runs: runs.data,
      waivers: waivers.data,
      manualPayments: manualPayments.data,
      refunds: refunds.data,
      bookings: bookings.data,
      domesticStaff: domesticStaff.data,
      moves: moves.data,
      channels: channels.data,
      ownershipTransfers: ownershipTransfers.data,
    },
    format,
  );
  const enabledSources = sources.filter((query) => query.fetchStatus !== 'idle' || query.data);
  return {
    items,
    /** True when the user may approve anything at all here. */
    anyAllowed:
      allow.join || allow.billing || allow.manualPayment || allow.booking || allow.community,
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
        case 'manual_payment':
          return action === 'approve'
            ? unwrap(
                api.POST('/v1/estates/{estateId}/manual-payments/{id}/approve', {
                  params: { path },
                  body: text ? { reason: text } : {},
                }),
              )
            : unwrap(
                api.POST('/v1/estates/{estateId}/manual-payments/{id}/reject', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'refund':
          return action === 'approve'
            ? unwrap(
                api.POST('/v1/estates/{estateId}/refunds/{id}/approve', {
                  params: { path },
                  body: text ? { reason: text } : {},
                }),
              )
            : unwrap(
                api.POST('/v1/estates/{estateId}/refunds/{id}/reject', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'booking':
          return action === 'approve'
            ? unwrap(api.POST('/v1/estates/{estateId}/bookings/{id}/approve', { params: { path } }))
            : unwrap(
                api.POST('/v1/estates/{estateId}/bookings/{id}/reject', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'staff_pass':
          return unwrap(
            api.POST('/v1/estates/{estateId}/domestic-staff/{id}/status', {
              params: { path },
              body: { status: action === 'approve' ? 'active' : 'ended' },
            }),
          );
        case 'move':
          return action === 'approve'
            ? unwrap(api.POST('/v1/estates/{estateId}/moves/{id}/complete', { params: { path } }))
            : unwrap(
                api.POST('/v1/estates/{estateId}/moves/{id}/cancel', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'channel':
          return action === 'approve'
            ? unwrap(api.POST('/v1/estates/{estateId}/channels/{id}/approve', { params: { path } }))
            : unwrap(
                api.POST('/v1/estates/{estateId}/channels/{id}/archive', {
                  params: { path },
                  body: { reason: text },
                }),
              );
        case 'ownership_transfer':
          return action === 'approve'
            ? unwrap(
                api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/approve', {
                  params: { path },
                  body: {},
                }),
              )
            : unwrap(
                api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/reject', {
                  params: { path },
                  body: { reason: text },
                }),
              );
      }
    },
    onSuccess: async () => {
      await Promise.all(
        [
          'join-requests',
          'billing-runs',
          'waivers',
          'manual-payments',
          'refunds',
          'bookings',
          'domestic-staff',
          'moves',
          'channels',
          'ownership-transfers',
          'residents',
        ].map((key) => queryClient.invalidateQueries({ queryKey: ['estate', estateId, key] })),
      );
    },
  });
}
