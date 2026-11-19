import { unwrap, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDate, formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  StatusPill,
  TextField,
  useSession,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  awaitingOwnerRequests,
  canCancelTransfer,
  canSellerConfirm,
  canSellerReject,
  formatShare,
  type OwnerJoinRequest,
  type OwnershipTransfer,
  TRANSFER_TONE,
} from '../../src/features/owner';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api, session } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

type OwnerTab = 'units' | 'approvals' | 'transfers';

/** Owner mode (resident-mobile.md §6.8): owned units, tenant approvals, and ownership transfers. */
export default function OwnerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useSession(session).user?.id;
  const { estateId, estateName, hasFeature } = useResident();
  const [tab, setTab] = useState<OwnerTab>('units');

  const [approving, setApproving] = useState<OwnerJoinRequest | null>(null);
  const [rejecting, setRejecting] = useState<OwnerJoinRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [confirmingTransfer, setConfirmingTransfer] = useState<OwnershipTransfer | null>(null);
  const [closingTransfer, setClosingTransfer] = useState<{
    transfer: OwnershipTransfer;
    action: 'reject' | 'cancel';
  } | null>(null);
  const [transferReason, setTransferReason] = useState('');

  const units = useQuery({
    queryKey: ['estate', estateId, 'owned-units'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/owned-units', { params: { path: { estateId } } })),
    enabled: hasFeature('property'),
  });
  const joinRequests = useQuery({
    queryKey: ['estate', estateId, 'join-requests', 'owner'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/join-requests', {
          params: { path: { estateId }, query: { status: 'awaiting_owner', limit: 50 } },
        }),
      ),
    enabled: hasFeature('occupancy'),
  });
  const transfers = useQuery({
    queryKey: ['estate', estateId, 'ownership-transfers'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/ownership-transfers', { params: { path: { estateId } } }),
      ),
    enabled: hasFeature('property'),
  });

  const approveJoin = useMutation({
    mutationFn: (request: OwnerJoinRequest) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/join-requests/{id}/approve', {
          params: { path: { estateId, id: request.id } },
          body: {},
        }),
      ),
    onSuccess: () => {
      setApproving(null);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'join-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'owned-units'] });
    },
  });

  const rejectJoin = useMutation({
    mutationFn: ({ request, reason }: { request: OwnerJoinRequest; reason: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/join-requests/{id}/reject', {
          params: { path: { estateId, id: request.id } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      setRejecting(null);
      setRejectReason('');
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'join-requests'] });
    },
  });

  const confirmTransfer = useMutation({
    mutationFn: (item: OwnershipTransfer) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/confirm', {
          params: { path: { estateId, id: item.id } },
        }),
      ),
    onSuccess: () => {
      setConfirmingTransfer(null);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'ownership-transfers'] });
    },
  });

  const closeTransfer = useMutation({
    mutationFn: ({
      item,
      action,
      reason,
    }: {
      item: OwnershipTransfer;
      action: 'reject' | 'cancel';
      reason: string;
    }) =>
      action === 'reject'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/reject', {
              params: { path: { estateId, id: item.id } },
              body: { reason: reason.trim() },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/cancel', {
              params: { path: { estateId, id: item.id } },
              body: { reason: reason.trim() },
            }),
          ),
    onSuccess: () => {
      setClosingTransfer(null);
      setTransferReason('');
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'ownership-transfers'] });
    },
  });

  const pull = usePullRefresh(() =>
    Promise.all([units.refetch(), joinRequests.refetch(), transfers.refetch()]),
  );
  const myOwnershipIds = new Set((units.data ?? []).map((unit) => unit.ownershipId));
  const pendingApprovals = awaitingOwnerRequests(joinRequests.data?.items ?? []);

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.owner.title')}
        subtitle={estateName}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
        backIcon={<Icon name="arrow-back" />}
      />

      <Segmented<OwnerTab>
        label={t('res.owner.title')}
        value={tab}
        onChange={setTab}
        options={[
          { key: 'units', label: t('res.owner.tab.units') },
          {
            key: 'approvals',
            label:
              pendingApprovals.length > 0
                ? t('res.owner.tab.approvalsCount', { count: pendingApprovals.length })
                : t('res.owner.tab.approvals'),
          },
          { key: 'transfers', label: t('res.owner.tab.transfers') },
        ]}
      />

      {tab === 'units' ? (
        <>
          {units.isPending ? <Skeleton height={140} /> : null}
          {units.isError ? (
            <ErrorState message={errorText(units.error)} onRetry={() => void units.refetch()} />
          ) : null}
          {units.data && units.data.length === 0 ? (
            <EmptyState
              icon={<Icon name="home-outline" size={28} color={colors.brand.primary} />}
              title={t('res.owner.unitsEmpty')}
              body={t('res.owner.unitsEmptyBody')}
            />
          ) : null}
          {(units.data ?? []).map((unit) => (
            <Card key={unit.ownershipId}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>
                  {unit.unitCode} {unit.unitName !== unit.unitCode ? `· ${unit.unitName}` : ''}
                </Text>
                {unit.unitStatus ? (
                  <StatusPill
                    tone={unit.unitStatus === 'occupied' ? 'success' : 'neutral'}
                    label={t(`space.status.${unit.unitStatus}` as MessageKey)}
                  />
                ) : null}
              </View>
              <Text style={styles.meta}>
                {t('res.owner.share', { percent: formatShare(unit.shareBasisPoints) })}
              </Text>
              <Text style={styles.body}>
                {unit.household
                  ? t('res.owner.occupant', { name: unit.household.name })
                  : t('res.owner.vacant')}
              </Text>
              <View style={styles.actionRow}>
                {hasFeature('billing') ? (
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label={t('res.owner.viewBills')}
                      variant="outline"
                      onPress={() => router.push('/pay')}
                    />
                  </View>
                ) : null}
                {hasFeature('occupancy') ? (
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label={t('res.owner.scheduleMove')}
                      variant="outline"
                      onPress={() => router.push('/moves')}
                    />
                  </View>
                ) : null}
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {tab === 'approvals' ? (
        <>
          {joinRequests.isPending ? <Skeleton height={140} /> : null}
          {joinRequests.isError ? (
            <ErrorState
              message={errorText(joinRequests.error)}
              onRetry={() => void joinRequests.refetch()}
            />
          ) : null}
          {joinRequests.data && pendingApprovals.length === 0 ? (
            <EmptyState
              icon={<Icon name="checkmark-done-outline" size={28} color={colors.brand.primary} />}
              title={t('res.owner.approvalsEmpty')}
              body={t('res.owner.approvalsEmptyBody')}
            />
          ) : null}
          {pendingApprovals.map((request) => (
            <Card key={request.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{request.fullName}</Text>
                <StatusPill
                  tone="info"
                  label={t(`join.relationship.${request.relationship}` as MessageKey)}
                />
              </View>
              <Text style={styles.meta}>
                {request.unit.code} · {formatDateTime(request.createdAt)}
              </Text>
              {request.message ? <Text style={styles.body}>{request.message}</Text> : null}
              <View style={styles.actionRow}>
                <View style={{ flex: 1 }}>
                  <ActionButton label={t('join.approve')} onPress={() => setApproving(request)} />
                </View>
                <View style={{ flex: 1 }}>
                  <ActionButton
                    label={t('join.reject')}
                    variant="outline"
                    onPress={() => {
                      setRejecting(request);
                      setRejectReason('');
                    }}
                  />
                </View>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {tab === 'transfers' ? (
        <>
          {transfers.isPending ? <Skeleton height={140} /> : null}
          {transfers.isError ? (
            <ErrorState
              message={errorText(transfers.error)}
              onRetry={() => void transfers.refetch()}
            />
          ) : null}
          {transfers.data && transfers.data.length === 0 ? (
            <EmptyState
              icon={<Icon name="swap-horizontal-outline" size={28} color={colors.brand.primary} />}
              title={t('res.owner.transfersEmpty')}
              body={t('res.owner.transfersEmptyBody')}
            />
          ) : null}
          {(transfers.data ?? []).map((item) => (
            <Card key={item.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>
                  {item.unitCode} · {t(`res.owner.transfer.type.${item.type}` as MessageKey)}
                </Text>
                <StatusPill
                  tone={TRANSFER_TONE[item.status]}
                  label={t(`res.owner.transfer.status.${item.status}` as MessageKey)}
                />
              </View>
              <Text style={styles.meta}>
                {t('res.owner.transfer.effective', {
                  date: formatDate(`${item.effectiveOn}T12:00:00Z`),
                })}
              </Text>
              <Text style={styles.body}>
                {t('res.owner.transfer.newOwners', {
                  owners: item.toOwners
                    .map(
                      (owner) =>
                        `${owner.companyName ?? owner.name} (${formatShare(owner.shareBasisPoints)})`,
                    )
                    .join(', '),
                })}
              </Text>
              {item.reason ? <Text style={styles.meta}>{item.reason}</Text> : null}
              <View style={styles.actionRow}>
                {canSellerConfirm(item, myOwnershipIds) ? (
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label={t('res.owner.transfer.confirm')}
                      onPress={() => setConfirmingTransfer(item)}
                    />
                  </View>
                ) : null}
                {canSellerReject(item, myOwnershipIds, me) ? (
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label={t('res.owner.transfer.reject')}
                      variant="outline"
                      onPress={() => {
                        setClosingTransfer({ transfer: item, action: 'reject' });
                        setTransferReason('');
                      }}
                    />
                  </View>
                ) : null}
                {canCancelTransfer(item, me) ? (
                  <View style={{ flex: 1 }}>
                    <ActionButton
                      label={t('res.owner.transfer.cancel')}
                      variant="outline"
                      onPress={() => {
                        setClosingTransfer({ transfer: item, action: 'cancel' });
                        setTransferReason('');
                      }}
                    />
                  </View>
                ) : null}
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <ConfirmModal
        visible={Boolean(approving)}
        title={approving ? t('res.owner.approveTitle', { name: approving.fullName }) : ''}
        body={
          approving
            ? t('res.owner.approveBody', {
                unit: approving.unit.code,
                relationship: t(`join.relationship.${approving.relationship}` as MessageKey),
              })
            : ''
        }
        confirmLabel={t('join.approve')}
        cancelLabel={t('common.cancel')}
        busy={approveJoin.isPending}
        error={approveJoin.isError ? errorText(approveJoin.error) : null}
        onConfirm={() => approving && approveJoin.mutate(approving)}
        onCancel={() => setApproving(null)}
      />

      <ConfirmModal
        visible={Boolean(confirmingTransfer)}
        title={t('res.owner.transfer.confirmTitle')}
        body={
          confirmingTransfer
            ? t('res.owner.transfer.confirmBody', { unit: confirmingTransfer.unitCode })
            : ''
        }
        confirmLabel={t('res.owner.transfer.confirm')}
        cancelLabel={t('common.cancel')}
        busy={confirmTransfer.isPending}
        error={confirmTransfer.isError ? errorText(confirmTransfer.error) : null}
        onConfirm={() => confirmingTransfer && confirmTransfer.mutate(confirmingTransfer)}
        onCancel={() => setConfirmingTransfer(null)}
      />

      {/* Reject join request modal */}
      <Modal
        visible={Boolean(rejecting)}
        transparent
        animationType="fade"
        onRequestClose={() => setRejecting(null)}
      >
        <Pressable
          style={styles.scrim}
          onPress={() => setRejecting(null)}
          accessibilityLabel={t('ui.close')}
        >
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>
              {rejecting ? t('res.owner.rejectTitle', { name: rejecting.fullName }) : ''}
            </Text>
            <Text style={styles.meta}>{t('res.owner.rejectBody')}</Text>
            <TextField
              label={t('res.owner.rejectReason')}
              placeholder={t('res.owner.rejectPlaceholder')}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              maxLength={500}
            />
            {rejectJoin.isError ? (
              <Banner tone="danger">{errorText(rejectJoin.error)}</Banner>
            ) : null}
            <ActionButton
              label={t('join.reject')}
              disabled={rejectReason.trim().length < 3}
              busy={rejectJoin.isPending}
              onPress={() =>
                rejecting && rejectJoin.mutate({ request: rejecting, reason: rejectReason })
              }
            />
            <ActionButton
              label={t('common.cancel')}
              variant="text"
              onPress={() => setRejecting(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reject or cancel transfer modal */}
      <Modal
        visible={Boolean(closingTransfer)}
        transparent
        animationType="fade"
        onRequestClose={() => setClosingTransfer(null)}
      >
        <Pressable
          style={styles.scrim}
          onPress={() => setClosingTransfer(null)}
          accessibilityLabel={t('ui.close')}
        >
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>
              {closingTransfer?.action === 'reject'
                ? t('res.owner.transfer.reject')
                : t('res.owner.transfer.cancel')}
            </Text>
            <TextField
              label={t('res.owner.transfer.reason')}
              value={transferReason}
              onChangeText={setTransferReason}
              multiline
              maxLength={500}
            />
            {closeTransfer.isError ? (
              <Banner tone="danger">{errorText(closeTransfer.error)}</Banner>
            ) : null}
            <ActionButton
              label={
                closingTransfer?.action === 'reject'
                  ? t('res.owner.transfer.reject')
                  : t('res.owner.transfer.cancel')
              }
              disabled={transferReason.trim().length < 3}
              busy={closeTransfer.isPending}
              onPress={() =>
                closingTransfer &&
                closeTransfer.mutate({
                  item: closingTransfer.transfer,
                  action: closingTransfer.action,
                  reason: transferReason,
                })
              }
            />
            <ActionButton
              label={t('common.cancel')}
              variant="text"
              onPress={() => setClosingTransfer(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  meta: {
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
  },
  body: {
    fontSize: typography.size.sm,
    color: colors.semantic.text,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
  },
  sheetTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
});
